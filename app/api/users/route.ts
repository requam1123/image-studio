/**
 * 用户配置 API
 *
 * 管理用户的 API Key、自定义地址、模型配置。
 * 配置存储在 users 表中，每个用户一行。
 *
 * 接口：
 *   GET  /api/users  — 获取当前用户配置
 *   PATCH /api/users — 更新当前用户配置
 *
 * API Key 存储策略：
 * - 多 Key 支持：用户在框里粘贴多个 Key（每行一个 sk-xxx），
 *   后端检测到换行符后拆分为数组，存为 JSON 字符串
 *   如：'["sk-aaa","sk-bbb","sk-ccc"]'
 * - 单 Key：直接存字符串
 * - 未配置：回退到 .env.local 的全局 API_KEY
 *
 * Token 轮转（token 文件 vs 用户配置）：
 * - 全局 token 文件在 tasks 路由中用于轮转
 * - 用户配置的 Key 通常用于自定义 API 地址的场景
 * - 两者互不冲突：tasks 路由优先使用 token 文件的 Keys
 *
 * 预设管理：预设存储在 presets 表，由 /api/users/presets 管理
 * （见 app/api/users/presets/route.ts）
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserConfig, updateUserConfig, loadTokens } from "@/lib/db";
import { getUserFromJwt } from "@/lib/auth";

/**
 * GET /api/users — 获取当前用户配置
 *
 * 返回字段：
 * - username: 当前用户名
 * - apiKey: 有效的 API Key（脱敏用 hasApiKey 表示是否存在）
 * - hasApiKey: 是否有配置 Key
 * - apiBaseUrl: 自定义 API 地址
 * - model: 使用的模型
 * - tokens: 全局 token 文件中的 Key 列表（前端展示用）
 */
export async function GET(request: NextRequest) {
  try {
    const username = await getUserFromJwt(request);
    if (!username) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const config = getUserConfig(username);
    const tokens = loadTokens();
    return NextResponse.json({
      username,
      apiKey: config.apiKey,
      hasApiKey: !!config.apiKey,
      apiBaseUrl: config.baseUrl,
      model: config.model,
      tokens,
    });
  } catch (e) {
    console.error("GET /api/users:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PATCH /api/users — 更新用户配置
 *
 * 请求体（所有字段可选）：
 * {
 *   apiKey: "sk-xxx\nsk-yyy",   // 多 Key 用换行分隔
 *   apiBaseUrl: "https://...",
 *   model: "gpt-image-2"
 * }
 *
 * 多 Key 处理：
 * - 按换行分割，筛选 sk- 开头的行
 * - 有多个 → 存为 JSON 数组字符串
 * - 只有一个 → 直接存字符串
 * - 传 null 或空字符串 → 清除已保存的 Key
 *
 * 注：只更新传了的字段，未传的字段保持不变。
 * 前端齿轮设置弹窗在用户修改时调用此接口。
 */
export async function PATCH(request: NextRequest) {
  try {
    const username = await getUserFromJwt(request);
    if (!username) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await request.json();

    // 处理多 Key 输入：检测换行符，拆分为 JSON 数组
    const rawKey = body.apiKey !== undefined ? (body.apiKey || null) : undefined;
    let finalKey: string | null = null;
    if (rawKey) {
      const lines = rawKey.split("\n").map((l: string) => l.trim()).filter((l: string) => l.startsWith("sk-"));
      finalKey = lines.length > 0 ? JSON.stringify(lines) : rawKey;
    } else if (rawKey !== undefined) {
      finalKey = rawKey; // 传 null 清除
    }

    updateUserConfig(username, {
      api_key: rawKey !== undefined ? (finalKey ?? undefined) : undefined,
      api_base_url: body.apiBaseUrl !== undefined ? body.apiBaseUrl : undefined,
      model: body.model !== undefined ? body.model : undefined,
    });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("PATCH /api/users:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
