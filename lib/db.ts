/**
 * 数据库层（SQLite）
 *
 * 使用 better-sqlite3（同步操作，无需 await）。
 * 数据库文件在 data/image.db，自动初始化所有表。
 *
 * 核心导出函数：queryAll / queryOne / execute（简化 SQL 操作）
 *
 * 5 张表：
 * - history: 图片历史记录（最终保存的结果）
 * - tasks:   异步任务队列（正在处理或刚完成的任务）
 * - users:   用户 API 配置（Key、地址、模型）
 * - presets: 用户保存的 API 配置预设
 * - token_counter: API Key 轮转计数器（多 Key 轮流使用）
 */

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import type { NextRequest } from "next/server";

// ── 数据库初始化 ──

const TEST_MODE = process.env.VITEST === "true";
const dbPath = TEST_MODE
  ? path.join(process.cwd(), "data", "test.db")
  : path.join(process.cwd(), "data", "image.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");   // WAL 模式：读写不互斥，性能更好
db.pragma("foreign_keys = ON");    // 外键约束
db.pragma("wal_autocheckpoint = 1000");  // WAL 每 1000 页自动 checkpoint（~4MB），防止 WAL 无限膨胀
db.pragma("wal_checkpoint(TRUNCATE)");   // 启动时清理已有 WAL，避免积压到上 GB

// ── 建表 ──

db.exec(`
  -- 历史记录表：最终保存的图片结果
  -- 生成或编辑完成后，后台将结果写入此表
  CREATE TABLE IF NOT EXISTS history (
    id              TEXT PRIMARY KEY,          -- 任务 ID（与 tasks 表一致）
    username        TEXT NOT NULL DEFAULT '',   -- 所属用户
    type            TEXT NOT NULL CHECK(type IN ('generate','edit')),  -- 生成/编辑
    model           TEXT NOT NULL DEFAULT 'gpt-image-2',  -- 使用的模型
    prompt          TEXT NOT NULL,              -- 提示词
    size            TEXT NOT NULL,              -- 图片尺寸
    quality         TEXT,                      -- 质量（仅生成）
    b64             TEXT NOT NULL,              -- 首张图片的 base64 数据
    file_path       TEXT,                      -- 首张图片保存到磁盘后的路径
    images_b64      TEXT,                      -- 多张图片的全部 base64（JSON 数组，仅 list 接口不返回）
    images_file_path TEXT,                     -- 多张图片文件路径（JSON 数组）
    original_b64    TEXT,                      -- 编辑前的原图（仅编辑类型）
    ref_images      TEXT,                      -- 参考图片 base64（JSON 数组，仅生成类型）
    usage_total     INTEGER,                   -- Token 消耗总数
    usage_input     INTEGER,                   -- 输入 Token
    usage_output    INTEGER,                   -- 输出 Token
    timestamp       INTEGER NOT NULL,           -- 生成时间
    duration        INTEGER,                   -- 耗时（秒）
    created_at      TEXT DEFAULT (datetime('now'))  -- 记录创建时间
  );
  CREATE INDEX IF NOT EXISTS idx_history_ts ON history(timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_history_username ON history(username);

  -- 用户配置表：每个用户可以设置自己的 API Key / 地址 / 模型
  CREATE TABLE IF NOT EXISTS users (
    username      TEXT PRIMARY KEY,             -- 用户名
    api_key       TEXT,                         -- API Key（多 Key 存 JSON 数组）
    api_base_url  TEXT,                         -- 自定义 API 地址
    model         TEXT,                         -- 使用的模型
    created_at    TEXT DEFAULT (datetime('now'))
  );

  -- Token 计数器：用于 API Key 轮转
  -- 每次生成时递增，取模得到当前使用的 Key 索引
  CREATE TABLE IF NOT EXISTS token_counter (
    id    INTEGER PRIMARY KEY DEFAULT 1,
    value INTEGER DEFAULT 0
  );
  INSERT OR IGNORE INTO token_counter (id, value) VALUES (1, 0);

  -- 预设表：用户保存的 API 配置预设（可快速切换）
  CREATE TABLE IF NOT EXISTS presets (
    id           TEXT PRIMARY KEY,
    username     TEXT NOT NULL DEFAULT '',
    name         TEXT NOT NULL,
    api_key      TEXT,
    api_base_url TEXT,
    model        TEXT,
    created_at   TEXT DEFAULT (datetime('now'))
  );

  -- 任务表：异步任务队列
  -- 用户点生成 → 创建任务记录 → 后台处理 → 更新状态
  -- 前端轮询此表获取进度
  CREATE TABLE IF NOT EXISTS tasks (
    id              TEXT PRIMARY KEY,           -- 任务 ID
    username        TEXT NOT NULL DEFAULT '',    -- 所属用户
    type            TEXT NOT NULL,               -- generate / edit
    model           TEXT,                        -- 模型
    prompt          TEXT,                        -- 提示词
    size            TEXT,                        -- 尺寸
    quality         TEXT,                        -- 质量
    ref_images      TEXT,                        -- 参考图（JSON 数组）
    count           INTEGER DEFAULT 1,           -- 生成张数
    status          TEXT NOT NULL DEFAULT 'pending',   -- pending → processing → completed / failed
    results         TEXT,                        -- 结果数组 JSON：[{b64, duration, usage?, error?}]
    progress        TEXT,                        -- 进度 JSON：{current: N, total: M}
    input_file_path TEXT,                        -- 编辑任务的输入文件路径
    created_at      INTEGER NOT NULL,            -- 创建时间（时间戳）
    completed_at    INTEGER                      -- 完成时间（时间戳）
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_username ON tasks(username);
  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
`);

// ── 列迁移：后续新增列时自动补上 ──

function ensureColumn(table: string, col: string, def: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  }
}
ensureColumn("history", "status", "TEXT");   // 旧表缺 status 列，补上
ensureColumn("users", "model", "TEXT");       // 旧表缺 model 列，补上
ensureColumn("presets", "model", "TEXT");     // 旧表缺 model 列，补上

// ── 用户配置工具函数 ──

/** 从 nginx X-Auth-User 头获取当前用户名（旧方式，已废弃，保留兼容） */
export function getUserFromRequest(request: NextRequest): string | null {
  return request.headers.get("x-auth-user") || null;
}

/**
 * 获取用户完整配置
 * 优先级：用户表配置 → 环境变量 API_KEY
 * 用户存入多 Key 时存 JSON 数组，这里取数组第一个
 */
export function getUserConfig(username: string | null): {
  apiKey: string | null;
  baseUrl: string | null;
  model: string | null;
} {
  if (!username) return { apiKey: process.env.API_KEY || null, baseUrl: null, model: null };
  try {
    const row = db
      .prepare("SELECT api_key, api_base_url, model FROM users WHERE username = ?")
      .get(username) as
      | { api_key: string | null; api_base_url: string | null; model: string | null }
      | undefined;
    const raw = row?.api_key;
    let apiKey = raw || null;
    if (raw) {
      // 如果存的是 JSON 数组（多 Key），取第一个
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) apiKey = parsed[0] || null;
      } catch {
        apiKey = raw;
      }
    }
    return {
      apiKey: apiKey || process.env.API_KEY || null,
      baseUrl: row?.api_base_url || null,
      model: row?.model || null,
    };
  } catch {
    return { apiKey: process.env.API_KEY || null, baseUrl: null, model: null };
  }
}

/** 更新用户配置（新增或修改字段） */
export function updateUserConfig(
  username: string,
  data: { api_key?: string; api_base_url?: string; model?: string }
): void {
  const existing = db
    .prepare("SELECT username FROM users WHERE username = ?")
    .get(username) as { username: string } | undefined;
  if (existing) {
    if (data.api_key !== undefined)
      db.prepare("UPDATE users SET api_key = ? WHERE username = ?").run(
        data.api_key || null,
        username
      );
    if (data.api_base_url !== undefined)
      db.prepare("UPDATE users SET api_base_url = ? WHERE username = ?").run(
        data.api_base_url || null,
        username
      );
    if (data.model !== undefined)
      db.prepare("UPDATE users SET model = ? WHERE username = ?").run(
        data.model || null,
        username
      );
  } else {
    db.prepare(
      "INSERT INTO users (username, api_key, api_base_url, model) VALUES (?, ?, ?, ?)"
    ).run(
      username,
      data.api_key || null,
      data.api_base_url || null,
      data.model || null
    );
  }
}

// ── SQL 快捷操作 ──

/**
 * 查询多条记录
 * 用法：queryAll("SELECT * FROM table WHERE x = ?", [val])
 */
export function queryAll(
  sql: string,
  params: unknown[] = []
): Record<string, unknown>[] {
  return db.prepare(sql).all(...params) as Record<string, unknown>[];
}

/** 查询单条记录（找不到返回 null） */
export function queryOne(
  sql: string,
  params: unknown[] = []
): Record<string, unknown> | null {
  return (
    (db.prepare(sql).get(...params) as Record<string, unknown>) || null
  );
}

/** 执行 INSERT / UPDATE / DELETE */
export function execute(sql: string, params: unknown[] = []): void {
  db.prepare(sql).run(...params);
}

// ── API Key 轮转 ──
/**
 * 工作原理：
 * - 读取 token 文件获取所有 Key（每行一个，需包含 sk-）
 * - 保存到内存 _tokens 数组
 * - 每次请求调用 getNextKeyIndex()，数据库计数器 +1
 * - 用 (计数器-1) % _tokens.length 取模获取当前 Key
 * - 保证多个请求轮流使用不同 Key，避免单个 Key 消耗过快
 */

let _tokens: string[] = [];

/** 从 token 文件加载所有 API Key */
export function loadTokens(): string[] {
  const fp = path.join(process.cwd(), "token");
  try {
    const text = fs.readFileSync(fp, "utf-8");
    _tokens = text
      .split("\n")
      .map((l: string) => l.trim())
      .filter((l: string) => l.includes("sk-"))
      .map(
        (l: string) => "sk-" + l.split("sk-")[1].split(/\s/)[0]
      );
  } catch {
    _tokens = [];
  }
  return _tokens;
}

/** 获取当前内存中的 tokens */
export function getTokens(): string[] {
  return _tokens;
}

/**
 * 获取下一个 Key 的索引（轮转）
 * 每次调用的计数器 +1，返回取模后的索引
 */
export function getNextKeyIndex(): number {
  if (_tokens.length === 0) return -1;
  db.prepare("UPDATE token_counter SET value = value + 1 WHERE id = 1").run();
  const row = db
    .prepare("SELECT value FROM token_counter WHERE id = 1")
    .get() as { value: number };
  return (row.value - 1) % _tokens.length;
}

export default db;
