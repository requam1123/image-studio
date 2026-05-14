/**
 * Next.js Middleware（代理）
 *
 * 每次请求（除公开路径外）都经过此中间件：
 * 1. 检查 cookie 中的 JWT
 * 2. 无效或过期 → 重定向到 /login
 * 3. 有效 → 将用户名注入 X-Auth-User 请求头
 *
 * matcher 排除规则：/_next/*、/uploads/*、/login、/api/*、/favicon.ico
 *
 * 注意：/api/* 排除是因为 POST 请求体可能很大（base64 图片），
 * middleware 默认 10MB 限制会截断 body。API 路由自己处理认证。
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyToken } from "@/lib/auth";

const publicPaths = [
  "/login",
  "/api/auth/",
  "/_next/static",
  "/_next/image",
  "/uploads",
  "/favicon.ico",
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 公开路径直接放行（不需要认证）
  if (publicPaths.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // 没有 cookie → 跳登录
  const token = request.cookies.get("token")?.value;
  if (!token) {
    return redirectToLogin(request);
  }

  // JWT 无效或过期 → 跳登录
  const payload = await verifyToken(token);
  if (!payload) {
    return redirectToLogin(request);
  }

  // 将用户名注入请求头，后端 API 直接读取
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("X-Auth-User", payload.username);

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

function redirectToLogin(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  if (request.nextUrl.pathname !== "/") {
    url.searchParams.set("redirect", request.nextUrl.pathname);
  }
  return NextResponse.redirect(url);
}

/**
 * matcher 配置说明：
 * 匹配所有路径，但不包括公开路径。
 * 注意：正则写法，匹配除列出的路径之外的所有请求。
 */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|uploads|favicon.ico|login|api).*)",
  ],
};
