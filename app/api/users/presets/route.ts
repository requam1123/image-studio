import { NextRequest, NextResponse } from "next/server";
import { queryAll, execute, queryOne } from "@/lib/db";
import { getUserFromJwt } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const username = await getUserFromJwt(request);
    if (!username) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const rows = queryAll("SELECT id, name, api_key as apiKey, api_base_url as apiBaseUrl, model, created_at FROM presets WHERE username = ? ORDER BY created_at DESC", [username]);
    return NextResponse.json({ presets: rows });
  } catch (e) {
    console.error("GET /api/users/presets:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const username = await getUserFromJwt(request);
    if (!username) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await request.json();
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await execute(
      "INSERT INTO presets (id, username, name, api_key, api_base_url, model, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))",
      [id, username, body.name || "未命名", body.apiKey || null, body.apiBaseUrl || null, body.model || null]
    );
    return NextResponse.json({ success: true, id });
  } catch (e) {
    console.error("POST /api/users/presets:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const username = await getUserFromJwt(request);
    if (!username) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
    const row = queryOne("SELECT username FROM presets WHERE id = ?", [id]);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (row.username !== username) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    await execute("DELETE FROM presets WHERE id = ?", [id]);
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("DELETE /api/users/presets:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
