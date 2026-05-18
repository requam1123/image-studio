/**
 * 任务队列 API（核心）
 *
 * 异步生图/编辑架构：
 *   用户点生成 → POST 创建任务（立即返回 taskId）
 *               → 前端轮询 GET /api/tasks/:taskId
 *               → 后台 processGenerateTask
 *               → 完成时更新数据库，前端轮询到结果
 *
 * 统一走 JSON，不再区分 FormData：
 *   generate: { type, model, prompt, size, quality, count, refImages? }
 *   edit:     { type: "edit", prompt, size, count, image: "base64..." }
 *
 * 数据流：
 *   POST（创建任务）→ pending
 *   processing（开始处理）
 *   → 并行发 N 个上游请求，每完成一个更新 results 和 progress
 *   → 全部完成 → completed，保存到 history
 *   → 部分失败或无结果 → failed
 */

import { NextRequest, NextResponse } from "next/server";
import { execute, queryOne, queryAll } from "@/lib/db";
import { getUserFromJwt } from "@/lib/auth";
import { loadTokens, getTokens, getNextKeyIndex, getUserConfig } from "@/lib/db";

const HISTORY_API = `http://localhost:${process.env.PORT || 3000}/api/history`;

let _tokensLoaded = false;
function ensureTokens() {
  if (!_tokensLoaded) {
    loadTokens();
    _tokensLoaded = true;
  }
}

/**
 * 启动时恢复：标记超时任务为失败
 *
 * PM2 重启会 kill 正在运行的后台 Promise。
 * 重启后扫描 status=processing 且超过 5 分钟的任务，标记为 failed。
 */
try {
  const stale = queryAll(
    "SELECT id FROM tasks WHERE status = 'processing' AND created_at < ?",
    [Date.now() - 300000]
  );
  for (const t of stale) {
    console.error(`标记超时任务 ${t.id} 为 failed`);
    execute(
      "UPDATE tasks SET status = 'failed', completed_at = ? WHERE id = ?",
      [Date.now(), t.id]
    );
  }
} catch {
  /* first load, table may not exist */
}

/** 验证 API Base URL 防止 SSRF */
function isValidApiBaseUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    const host = parsed.hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0") return false;
    if (host.startsWith("10.") || host.startsWith("172.16.") || host.startsWith("192.168.")) return false;
    if (host === "169.254.169.254") return false;
    return true;
  } catch {
    return false;
  }
}

/** 保存任务结果到 history（带 60 秒超时，写盘 + 缩略图需要时间） */
async function saveResultsToHistory(
  taskId: string,
  username: string,
  isEdit: boolean,
  model: string,
  task: Record<string, unknown>,
  refImages: string[] | undefined,
  successResults: Record<string, unknown>[]
) {
  const b64s = successResults.map((r) => r!.b64 as string);
  const usage = successResults[0]?.usage as Record<string, number> | undefined;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    await fetch(HISTORY_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: taskId,
        username,
        type: isEdit ? "edit" : "generate",
        model,
        prompt: task.prompt as string,
        size: (task.size as string) || "auto",
        quality: task.quality && task.quality !== "auto" ? task.quality as string : undefined,
        refImages: isEdit ? undefined : refImages,
        originalB64: isEdit ? refImages?.[0] : undefined,
        b64: b64s[0],
        imagesB64: b64s.length > 1 ? b64s : undefined,
        timestamp: Date.now(),
        status: "completed",
        usage: usage
          ? { total: usage.total || 0, input: usage.input || 0, output: usage.output || 0 }
          : undefined,
      }),
      signal: controller.signal,
    });
  } catch (e) {
    console.error(`保存任务 ${taskId} 到 history 失败:`, e);
  } finally {
    clearTimeout(timeout);
  }
}

// ── POST: 创建任务 ──

/**
 * 创建任务
 *
 * 统一 JSON 格式，生成和编辑都走此入口。
 * 编辑任务的图片以 base64 传入（image 字段）。
 *
 * 流程：
 * 1. 验证 JWT
 * 2. 创建任务记录写入 tasks 表
 * 3. 启动后台处理（不 await，fire-and-forget）
 * 4. 立即返回 taskId
 */
export async function POST(request: NextRequest) {
  try {
    ensureTokens();
    const username = await getUserFromJwt(request);
    if (!username) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    
    if (!body.prompt?.trim()) {
      return NextResponse.json({ error: "缺少提示词" }, { status: 400 });
    }

    const type = body.type || "generate";
    if (!["generate", "edit"].includes(type)) {
      return NextResponse.json({ error: "无效的任务类型" }, { status: 400 });
    }
    const count = Math.min(body.count || 1, 5);

    const taskId = crypto.randomUUID();

    // ref_images 统一存 JSON 数组：
    // generate 有多张参考图时传 refImages 数组
    // edit 的单张图片以 image 字段传入 base64，存为 [image]
    let refImages: string | null = null;
    if (type === "edit" && body.image) {
      refImages = JSON.stringify([body.image]);
    } else if (body.refImages && Array.isArray(body.refImages)) {
      refImages = JSON.stringify(body.refImages);
    }

    execute(
      `INSERT INTO tasks (id, username, type, model, prompt, size, quality, ref_images, count, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [
        taskId,
        username,
        type,
        body.model || "gpt-image-2",
        body.prompt.trim(),
        body.size || "auto",
        body.quality || "auto",
        refImages,
        count,
        Date.now(),
      ]
    );

    // 启动后台处理（不 await）
    processGenerateTask(taskId).catch((err) => {
      console.error(`processGenerateTask ${taskId}:`, err);
      execute(
        "UPDATE tasks SET status = 'failed', completed_at = ? WHERE id = ?",
        [Date.now(), taskId]
      );
    });

    return NextResponse.json({ taskId, status: "pending" });
  } catch (e) {
    console.error("POST /api/tasks:", e);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

// ── 后台处理：生成/编辑任务 ──

/**
 * 后台任务处理函数（统一处理生成和编辑）
 *
 * 根据 task.type 决定上游端点：
 *   "edit"    → /v1/images/edits
 *   "generate" → /v1/images/generations
 *
 * 所有参数从数据库 tasks 表读取（model、size、quality 等均在 INSERT 时存入）。
 */
async function processGenerateTask(
  taskId: string
) {
  try {
    const tokens = getTokens();
    const task = queryOne("SELECT * FROM tasks WHERE id = ?", [taskId]);
    if (!task) return;
    const t = task as Record<string, unknown>;

    const count = (t.count as number) || 1;
    const isEdit = t.type === "edit";
    const refImages = t.ref_images
      ? JSON.parse(t.ref_images as string)
      : undefined;

    const username = t.username as string;
    const userConfig = username ? getUserConfig(username) : null;
    let apiBase = userConfig?.baseUrl || process.env.API_BASE_URL || "";
    if (apiBase && !isValidApiBaseUrl(apiBase)) {
      console.warn(`用户 ${username} 设置了无效的 apiBaseUrl: ${apiBase}，回退到默认`);
      apiBase = "";
    }
    const model = (userConfig?.model || t.model as string || "gpt-image-2") as string;

    const endpoint = isEdit ? `${apiBase}/v1/images/edits` : `${apiBase}/v1/images/generations`;
    
    // task表插入新task
    execute("UPDATE tasks SET status = 'processing' WHERE id = ?", [taskId]);

    const results: (Record<string, unknown> | null)[] = Array.from(
      { length: count },
      () => null
    );
    let completedCount = 0;

    async function fetchOne(i: number) {
      // apiKey Detect
      const apiKey =
        tokens.length > 0
          ? tokens[getNextKeyIndex() % tokens.length]
          : userConfig?.apiKey || null;
      if (!apiKey) {
        results[i] = { error: "No API keys configured" };
        return;
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 300000);

        const reqBody: Record<string, unknown> = {
          model,
          prompt: t.prompt as string,
          response_format: "b64_json",
        };
        if (t.size && t.size !== "auto") reqBody.size = t.size as string;
        if (t.quality && t.quality !== "auto")
          reqBody.quality = t.quality as string;
        if (refImages && refImages.length > 0) {
          // edit 只有单张图片，generate 可能有多个参考图
          reqBody.image = isEdit ? refImages[0] : refImages;
        }

        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(reqBody),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        const bodyText = await res.text();
        if (!res.ok) {
          console.error(`上游 API 错误 (${res.status}):`, bodyText.slice(0, 500));
          results[i] = { error: "上游 API 请求失败" };
          return;
        }

        const data = JSON.parse(bodyText);
        results[i] = {
          b64: data.data?.[0]?.b64_json || null,
          duration: Math.floor(
            (Date.now() - (t.created_at as number)) / 1000
          ),
          usage: data.usage
            ? {
                total: data.usage.total_tokens,
                input: data.usage.input_tokens,
                output: data.usage.output_tokens,
              }
            : undefined,
        };
      } catch (err) {
        console.error(`fetchOne ${i} 失败:`, err);
        results[i] = { error: "网络请求失败" };
      }
    }

    const promises = Array.from({ length: count }, (_, i) =>
      fetchOne(i).then(() => {
        completedCount++; // 不需要锁：所有 .then() 回调都排在同一个微任务队列里，一个执行完才执行下一个
        execute(
          "UPDATE tasks SET results = ?, progress = ? WHERE id = ?",
          [
            JSON.stringify([...results]),
            JSON.stringify({ current: completedCount, total: count }),
            taskId,
          ]
        );
      })
    );
    // 全部完成后，判断成功/失败
    await Promise.all(promises);

    const successResults = results.filter((r) => r?.b64);
    const status = successResults.length > 0 ? "completed" : "failed";

    execute(
      "UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?",
      [status, Date.now(), taskId]
    );

    // 保存到 history
    if (successResults.length > 0) {
      await saveResultsToHistory(taskId, username, isEdit, model, t, refImages, successResults as Record<string, unknown>[]);
    }
  } catch (err) {
    console.error(`processGenerateTask ${taskId} 失败:`, err);
    execute(
      "UPDATE tasks SET status = 'failed', completed_at = ? WHERE id = ?",
      [Date.now(), taskId]
    );
  }
}

// ── GET: 列出当前用户的任务 ──

export async function GET(request: NextRequest) {
  try {
    const username = await getUserFromJwt(request);
    if (!username) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rows = queryAll(
      `SELECT id, type, prompt, size, count, status, progress, created_at, completed_at
       FROM tasks WHERE username = ? ORDER BY created_at DESC LIMIT 20`,
      [username]
    );
    return NextResponse.json({
      tasks: rows.map((r) => ({
        taskId: r.id,
        type: r.type,
        prompt: r.prompt,
        size: r.size,
        count: r.count,
        status: r.status,
        progress: r.progress ? JSON.parse(r.progress as string) : null,
        createdAt: r.created_at,
        completedAt: r.completed_at,
      })),
    });
  } catch (e) {
    console.error("GET /api/tasks:", e);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
