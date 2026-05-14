/**
 * JWT 认证模块
 *
 * 使用 jose 库（Next.js 支持的 Edge Runtime 兼容 JWT 库）。
 * 密钥来自 .env.local 的 JWT_SECRET，无配置时用开发默认值。
 *
 * 流程：
 *   登录 POST /api/auth/login
 *     → verifyHtpasswd(username, password)   验证密码
 *     → signToken(username)                  签发 JWT
 *     → 写入 httpOnly cookie（30 天有效期）
 *
 *   请求中间件 middleware.ts
 *     → 读取 cookie 的 token
 *     → verifyToken(token)                   验证 JWT
 *     → 设置 X-Auth-User 请求头传递给后端
 *
 *   后端 API getUserFromJwt(request)
 *     → 优先读取 X-Auth-User 头（由 middleware 注入）
 *     → 回退：直接从 cookie 解析 JWT（middleware 未覆盖的路径）
 */

import { SignJWT, jwtVerify } from "jose";
import type { NextRequest } from "next/server";

const secret = new TextEncoder().encode(
  process.env.JWT_SECRET || "fallback-dev-secret-change-in-production"
);

/** 签发 JWT（30 天有效期） */
export async function signToken(username: string): Promise<string> {
  return new SignJWT({ username })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret);
}

/** 验证 JWT，返回用户名（过期或无效返回 null） */
export async function verifyToken(
  token: string
): Promise<{ username: string } | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return { username: payload.username as string };
  } catch {
    return null;
  }
}

/**
 * 从请求中获取当前用户名
 *
 * 读取顺序：
 * 1. X-Auth-User 请求头（由 middleware.ts 在每次请求时注入）
 * 2. 回退：直接从 cookie 解析 JWT
 *
 * 注意：如果请求没经过 middleware（比如 server-side fetch），
 * 需要走回退逻辑直接从 cookie 解析。
 */
export async function getUserFromJwt(
  request: NextRequest
): Promise<string | null> {
  // 优先使用 middleware 注入的请求头（性能更好）
  const headerUser = request.headers.get("x-auth-user");
  if (headerUser) return headerUser;

  // 回退：直接从 JWT cookie 解析
  const token = request.cookies.get("token")?.value;
  if (token) {
    const payload = await verifyToken(token);
    if (payload) return payload.username;
  }
  return null;
}
