/**
 * 历史记录 API（CRUD）
 *
 * 图片生成/编辑完成后，后台调用 POST 将结果保存到此表。
 * 前端展示历史列表、查看详情、删除记录。
 *
 * 图片存储策略：
 * - b64 写入磁盘文件（public/uploads/history/{id}_{n}.png）
 * - 同时生成 256px 缩略图（sharp，~35KB vs 2MB），
 *   用于 HistoryPanel（56x56）的缩略展示
 * - 列表接口只返回 filePath，不返回 b64（节省带宽）
 * - 详情接口（?id=xxx）才返回 b64（点大图时用）
 * - 删除记录时同步删除磁盘文件
 *
 * 接口：
 *   GET  /api/history         — 列表（最近 50 条）
 *   GET  /api/history?id=xxx  — 单个详情（含 b64）
 *   POST /api/history         — 创建（后台调用）
 *   PATCH /api/history        — 更新状态/duration
 *   DELETE /api/history?id=xxx— 删除单条
 *   DELETE /api/history       — 清空当前用户所有记录
 *
 * 注：writeB64File 和 sharpen B64File 使用 async（sharp 是异步 API），
 * 与 tasks 路由的同步 SQLite 操作不同，注意不要混淆。
 */

import { NextRequest, NextResponse } from "next/server";
import { queryAll, queryOne, execute } from "@/lib/db";
import { getUserFromJwt } from "@/lib/auth";
import fs from "fs";
import path from "path";
import sharp from "sharp";

const MAX_ITEMS = 50;

/**
 * 将 base64 保存为图片文件 + 生成缩略图
 *
 * @param b64      base64 数据（可能含 data:image/png;base64, 前缀）
 * @param filename 文件名，如 "12345-abc_0.png"
 * @returns        文件路径和缩略图路径（URL 路径，非磁盘路径）
 *
 * 缩略图用 sharp 缩放到 256px 宽，PNG quality 75。
 * 失败时只记录日志，不影响主图保存。
 */
async function writeB64File(b64: string, filename: string): Promise<{ filePath: string; thumbPath: string }> {
  const dir = path.join(process.cwd(), "public", "uploads", "history");
  fs.mkdirSync(dir, { recursive: true });

  // 去掉可能的前缀（前端粘贴的 data URL 等）
  const raw = b64.includes("base64,") ? b64.split("base64,")[1] : b64;
  const buf = Buffer.from(raw, "base64");

  // 写主图
  fs.writeFileSync(path.join(dir, filename), buf);

  // 生成缩略图：同名 _thumb.png
  const ext = path.extname(filename);
  const thumbFilename = filename.slice(0, -ext.length) + '_thumb' + ext;
  try {
    await sharp(buf).resize(256).png({ quality: 75 }).toFile(path.join(dir, thumbFilename));
  } catch (e) {
    console.error(`生成缩略图失败 ${filename}:`, e);
  }

  return { filePath: `/uploads/history/${filename}`, thumbPath: `/uploads/history/${thumbFilename}` };
}

/** 安全解析 JSON 字符串（可能为空或非 JSON） */
function safeParse(val: unknown): unknown {
  if (val == null) return undefined;
  return typeof val === "string" ? JSON.parse(val) : val;
}

/**
 * 从数据库行构造返回对象
 *
 * @param row    数据库查询结果
 * @param detail 是否返回详细内容（含 b64）
 *
 * detail=true 时：返回 b64 和 imagesB64（点大图用）
 * detail=false 时：只返回 filePath（列表用，节省带宽）
 *
 * usage 字段数据库分三列存（total/input/output），
 * 返回时合并为 { total, input, output } 对象。
 */
function itemFromRow(row: Record<string, any>, detail = false) {
  const imagesFilePath = safeParse(row.images_file_path) as string[] | undefined;
  const imagesB64 = safeParse(row.images_b64) as string[] | undefined;
  const base = {
    id: row.id,
    type: row.type,
    model: row.model,
    prompt: row.prompt,
    size: row.size,
    quality: row.quality ?? undefined,
    timestamp: Number(row.timestamp),
    duration: row.duration ?? undefined,
    status: row.status ?? undefined,
    usage:
      row.usage_total != null
        ? { total: row.usage_total, input: row.usage_input, output: row.usage_output }
        : undefined,
    filePath: row.file_path ?? undefined,
    imagesFilePath,
    imagesCount: imagesFilePath ? imagesFilePath.length : (row.file_path ? 1 : 1),
    refCount: row.refCount || 0,
  };
  if (detail) {
    return {
      ...base,
      originalB64: row.original_b64 ?? undefined,
      refImages: safeParse(row.ref_images) as string[] | undefined,
      // 有 file_path 说明已写盘，不返回 b64（避免传输 2MB+ base64）
      b64: row.file_path ? undefined : (row.b64 ?? undefined),
      imagesB64: row.file_path ? undefined : imagesB64,
    };
  }
  return base;
}

// ── 列表 / 详情 ──

/**
 * GET /api/history — 历史记录列表
 *
 * 参数：
 *   ?id=xxx  — 单条详情（返回 b64）
 *   无参数   — 最近 MAX_ITEMS 条（只返回元数据）
 *
 * 排序：按 timestamp 倒序（最新的在前）
 * 查询范围：当前用户的数据 + username 为空的历史数据
 */
export async function GET(request: NextRequest) {
  try {
    const username = (await getUserFromJwt(request)) || "";
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    // 单条详情
    if (id) {
      const row = queryOne(
        "SELECT * FROM history WHERE id = ? AND (username = ? OR username = '') LIMIT 1",
        [id, username]
      );
      if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json({ item: itemFromRow(row, true) });
    }

    // 列表（元数据，不含 b64）
    const rows = queryAll(
      `SELECT id, type, model, prompt, size, quality, timestamp, duration, status,
              usage_total, usage_input, usage_output,
              file_path, images_file_path, json_array_length(ref_images) as refCount
       FROM history WHERE username = ? OR username = '' ORDER BY timestamp DESC LIMIT ?`,
      [username, MAX_ITEMS]
    );
    return NextResponse.json({ items: rows.map((r) => itemFromRow(r)) });
  } catch (e) {
    console.error("GET /api/history:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ── 创建 ──

/**
 * POST /api/history — 保存图片到历史记录
 *
 * 调用方：tasks 路由的 processGenerateTask / processEditTask（后台自动调用）
 * 也支持：前端直接调用（兼容旧逻辑）
 *
 * 流程：
 * 1. 将 b64 写入磁盘文件（public/uploads/history/{id}_{n}.png）
 * 2. INSERT OR REPLACE 写入 history 表
 *
 * 支持多张图：imagesB64 数组，每张依次写盘
 * 单张图：b64 字段（首张）
 *
 * 注意：INSERT OR REPLACE 基于 PRIMARY KEY id，
 * 同一任务重复调用不会产生重复记录。
 */
export async function POST(request: NextRequest) {
  try {
    const username = (await getUserFromJwt(request)) || "";
    const item = await request.json();

    let filePath: string | null = null;
    let thumbPath: string | null = null;
    let imagesFilePath: string[] | null = null;
    let imagesThumbPath: string[] | null = null;

    // 写首张图
    if (item.b64) {
      const result = await writeB64File(item.b64, `${item.id}_0.png`);
      filePath = result.filePath;
      thumbPath = result.thumbPath;
    }
    // 写多张图（如果有）
    if (item.imagesB64 && Array.isArray(item.imagesB64)) {
      const results = await Promise.all(
        item.imagesB64.map((b64: string, i: number) =>
          writeB64File(b64, `${item.id}_${i}.png`)
        )
      );
      imagesFilePath = results.map(r => r.filePath);
      imagesThumbPath = results.map(r => r.thumbPath);
    }

    await execute(
      `INSERT OR REPLACE INTO history
       (id, username, type, model, prompt, size, quality, b64, file_path, images_b64, images_file_path,
        original_b64, ref_images, usage_total, usage_input, usage_output, timestamp, duration, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item.id, username,
        item.type || "generate", item.model || "gpt-image-2",
        item.prompt || "", item.size || "auto",
        item.quality ?? null, item.b64 || "",
        filePath,
        item.imagesB64 ? JSON.stringify(item.imagesB64) : null,
        imagesFilePath ? JSON.stringify(imagesFilePath) : null,
        item.originalB64 ?? null,
        item.refImages ? JSON.stringify(item.refImages) : null,
        item.usage?.total ?? null, item.usage?.input ?? null,
        item.usage?.output ?? null,
        item.timestamp ?? Date.now(), item.duration ?? null,
        item.status || "completed",
      ]
    );
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("POST /api/history:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ── 更新 ──

/**
 * PATCH /api/history — 更新历史记录状态
 *
 * 主要场景：任务完成后更新 status 和 duration
 * （有些任务先创建空记录，完成后补全）
 *
 * 如果请求含 b64/imagesB64，同时写盘并更新 file_path。
 * 防止越权：校验当前用户与记录 owner 匹配。
 */
export async function PATCH(request: NextRequest) {
  try {
    const username = (await getUserFromJwt(request)) || "";
    const item = await request.json();
    const existing = queryOne("SELECT username FROM history WHERE id = ?", [item.id]);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // 非本人记录禁止修改
    if (existing.username && existing.username !== username) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (item.b64 || item.imagesB64) {
      let filePath: string | null = null;
      let imagesFilePath: string[] | null = null;
      if (item.b64) {
        const result = await writeB64File(item.b64, `${item.id}_0.png`);
        filePath = result.filePath;
      }
      if (item.imagesB64 && Array.isArray(item.imagesB64)) {
        const results = await Promise.all(
          item.imagesB64.map((b64: string, i: number) =>
            writeB64File(b64, `${item.id}_${i}.png`)
          )
        );
        imagesFilePath = results.map(r => r.filePath);
      }
      await execute(
        `UPDATE history SET status=?, file_path=?, images_file_path=?, duration=?, usage_total=?, usage_input=?, usage_output=? WHERE id=?`,
        [item.status || "completed", filePath,
         imagesFilePath ? JSON.stringify(imagesFilePath) : null,
         item.duration ?? null,
         item.usage?.total ?? null, item.usage?.input ?? null, item.usage?.output ?? null,
         item.id]
      );
    } else {
      await execute(
        `UPDATE history SET status=?, duration=? WHERE id=?`,
        [item.status || "failed", item.duration ?? null, item.id]
      );
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("PATCH /api/history:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ── 删除 ──

/**
 * DELETE /api/history — 删除历史记录
 *
 * 删除时会同步删除磁盘上的图片文件和缩略图。
 * 不传 ?id=xxx 时清空当前用户所有记录。
 *
 * 越权检查：非本人记录禁止删除（username 为空的历史记录允许所有人删）。
 */
export async function DELETE(request: NextRequest) {
  try {
    const username = (await getUserFromJwt(request)) || "";
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (id) {
      // 单条删除：先查文件路径再删
      const row = await queryOne("SELECT file_path, images_file_path, username FROM history WHERE id = ?", [id]);
      if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
      if (row.username && row.username !== username) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      // 删除磁盘文件（忽略不存在的情况）
      const publicDir = path.join(process.cwd(), "public");
      if (row.file_path) {
        try { fs.unlinkSync(path.join(publicDir, row.file_path as string)); } catch { /* ignore */ }
      }
      const imgs = safeParse(row.images_file_path) as string[] | undefined;
      if (imgs) {
        imgs.forEach((fp) => { try { fs.unlinkSync(path.join(publicDir, fp)); } catch { /* ignore */ } });
      }
      await execute("DELETE FROM history WHERE id = ?", [id]);
    } else {
      // 清空当前用户全部记录
      await execute("DELETE FROM history WHERE username = ?", [username]);
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("DELETE /api/history:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
