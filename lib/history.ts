/**
 * 历史记录前端 API 封装
 *
 * 封装对 /api/history 的 CRUD 操作，供 HistoryPanel、RecentResults 等组件使用。
 * 所有函数都有 try-catch 容错，网络失败时不抛异常，返回空结果。
 *
 * HistoryItem 是前端组件的通用类型定义，与数据库表不完全对应：
 * - 数据库中 b64 / images_b64 可能为空（写盘后已删除 base64 节省空间）
 * - 前端通过 filePath / imagesFilePath 加载图片
 * - refImages / originalB64 仅在使用懒加载详情时（GET /api/history?id=xxx）返回
 *
 * 数据流：
 *   任务完成后端自动 POST /api/history 保存
 *   → history 表 INSERT 记录
 *   → 前端 loadHistory() GET /api/history
 *   → HistoryPanel / RecentResults 展示
 */

export interface HistoryItem {
  id: string;
  type: "generate" | "edit";
  model: string;
  prompt: string;
  size: string;
  quality?: string;
  refImages?: string[];     // 参考图 base64 数组（仅 generate 类型）
  b64?: string;             // 首张图 base64（懒加载详情时可能返回）
  imagesB64?: string[];     // 多张图 base64（列表接口不返回，节省带宽）
  filePath?: string;        // 首张图片的 URL 路径（主要使用）
  imagesFilePath?: string[]; // 多张图片 URL 路径
  imagesCount?: number;
  timestamp: number;
  duration?: number;
  status?: "pending" | "completed" | "failed";
  usage?: {
    total: number;
    input: number;
    output: number;
  };
  originalB64?: string;     // 编辑前原图（仅 edit 类型，懒加载时返回）
}

const API_BASE = "/api/history";

/** 获取单条历史详情（含 b64、refImages 等完整数据） */
export async function getHistoryItem(id: string): Promise<HistoryItem | null> {
  try {
    const res = await fetch(`${API_BASE}?id=${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.item ?? null;
  } catch {
    return null;
  }
}

/** 获取最近 50 条历史记录列表（无 b64，只有 filePath / imagesFilePath） */
export async function loadHistory(): Promise<HistoryItem[]> {
  try {
    const res = await fetch(API_BASE);
    if (!res.ok) return [];
    const data = await res.json();
    return data.items ?? [];
  } catch {
    return [];
  }
}

/** 添加一条历史记录（由后端任务处理函数自动调用，前端也可手动调用） */
export async function addHistory(item: HistoryItem) {
  try {
    await fetch(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item),
    });
  } catch {
    // silently ignore
  }
}

/** 清空当前用户的所有历史记录 */
export async function clearHistory() {
  try {
    await fetch(API_BASE, { method: "DELETE" });
  } catch {
    // silently ignore
  }
}

/** 删除单条历史记录（同步删除磁盘图片文件和缩略图） */
export async function deleteHistoryItem(id: string) {
  try {
    await fetch(`${API_BASE}?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  } catch {
    // silently ignore
  }
}
