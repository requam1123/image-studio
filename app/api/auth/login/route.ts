/**
 * 登录 API
 *
 * POST /api/auth/login
 *
 * 流程：
 * 1. 接收用户名/密码（JSON body）
 * 2. verifyHtpasswd 验证（与 nginx htpasswd 文件匹配）
 * 3. signToken 签发 JWT（30 天有效期）
 * 4. 写入 httpOnly cookie（secure + sameSite=lax）
 * 5. 返回 { success: true, username }
 *
 * JWT 存 httpOnly cookie 的意义：
 * - httpOnly：JS 无法读取，防 XSS 窃取 token
 * - secure：仅 HTTPS 传输（本地 dev 模式除外）
 * - sameSite=lax：跨站请求不携带，防 CSRF
 * - path=/：全站生效
 *
 * 关联文件：
 * - lib/auth.ts：signToken / verifyToken 实现
 * - lib/htpasswd.ts：verifyHtpasswd 实现（读取 /etc/nginx/.htpasswd_play）
 * - middleware.ts：每次请求自动验证 JWT
 */

import { NextRequest, NextResponse } from "next/server";
import { signToken } from "@/lib/auth";
import { verifyHtpasswd } from "@/lib/htpasswd";

export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json();
    if (!username || !password) {
      return NextResponse.json({ error: "请输入用户名和密码" }, { status: 400 });
    }

    // 验证密码（htpasswd 文件验证）
    if (!verifyHtpasswd(username, password)) {
      return NextResponse.json({ error: "用户名或密码错误" }, { status: 401 });
    }

    // 签发 JWT
    const token = await signToken(username);

    // 写入 httpOnly cookie
    const response = NextResponse.json({ success: true, username });
    response.cookies.set("token", token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 天
    });

    return response;
  } catch (e) {
    console.error("POST /api/auth/login:", e);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
