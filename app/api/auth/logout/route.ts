/**
 * 登出 API
 *
 * POST /api/auth/logout
 *
 * 清除 httpOnly cookie 中的 JWT。
 * 通过设置 maxAge=0 让浏览器立即删除 cookie。
 *
 * 流程简单：不需要验证当前是否已登录，
 * 即使没有有效的 cookie 也能调用，保证幂等。
 */

import { NextResponse } from "next/server";

export async function POST() {
  const response = NextResponse.json({ success: true });
  // maxAge=0 告诉浏览器立即删除此 cookie
  response.cookies.set("token", "", {
    httpOnly: true,
    secure: true,
    path: "/",
    maxAge: 0,
  });
  return response;
}
