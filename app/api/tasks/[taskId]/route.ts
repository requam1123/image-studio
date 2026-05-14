/**
 * 任务状态轮询 API
 *
 * 前端提交生成/编辑任务后，通过此接口轮询任务进度。
 * 每 2 秒请求一次，直到 status 为 completed 或 failed。
 *
 * 返回内容：
 * - 任务元数据（type / prompt / size / count / status）
 * - results 数组：每张图片的 b64 / duration / usage / error
 *   （未完成的项为 null，逐条填充）
 * - progress：{ current: N, total: M }，当前完成/总数
 *
 * 安全性：
 * - 每个请求验证 JWT（getUserFromJwt）
 * - WHERE 条件包含 username，避免 A 看到 B 的任务
 * - 不存在的 taskId 返回 404
 */

import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { getUserFromJwt } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const username = await getUserFromJwt(request);
    if (!username) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // taskId 从 URL 路径末段提取，如 /api/tasks/12345-abc → "12345-abc"
    const taskId = request.nextUrl.pathname.split("/").pop();
    if (!taskId) {
      return NextResponse.json({ error: "Missing taskId" }, { status: 400 });
    }

    // 只查当前用户的任务（隔离性）
    const row = queryOne(
      `SELECT id, type, prompt, size, model, count, status, results, progress, created_at, completed_at
       FROM tasks WHERE id = ? AND username = ?`,
      [taskId, username]
    );
    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // results 和 progress 存为 JSON 字符串，取出时 parse
    // 未完成时 results 可能大部分为 null，已完成则全量填充
    return NextResponse.json({
      taskId: row.id,
      type: row.type,
      prompt: row.prompt,
      size: row.size,
      model: row.model,
      count: row.count,
      status: row.status,
      results: row.results ? JSON.parse(row.results as string) : null,
      progress: row.progress ? JSON.parse(row.progress as string) : null,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    });
  } catch (e) {
    console.error("GET /api/tasks/[taskId]:", e);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
