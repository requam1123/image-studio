/**
 * 前端通用工具函数
 *
 * 提供图片尺寸/质量常量、base64 转换、下载/保存/缩略图工具。
 *
 * 注意：
 * - generateImage / editImage 已在异步任务改造中被废弃（统一走 POST /api/tasks），
 *   但保留在此处作为参考。前端组件不再导入使用。
 * - SIZES / QUALITIES 仅供 ImageGenerator 使用（编辑器有自己的 EDIT_SIZES）。
 */

/**
 * 尺寸选项（用于生成 Tab）
 *
 * 与 ImageEditor 的 EDIT_SIZES 不同：
 * - SIZES 不包含 "auto"（生成必须有明确尺寸）
 * - EDIT_SIZES 多了 "auto"（保留原图尺寸）
 */
export const SIZES = [
  { label: "1024×1024", value: "1024x1024" },
  { label: "1536×1024 (横屏)", value: "1536x1024" },
  { label: "1024×1536 (竖屏)", value: "1024x1536" },
  { label: "2048×2048 (2K)", value: "2048x2048" },
  { label: "2048×1152 (2K横屏)", value: "2048x1152" },
  { label: "3840×2160 (4K横屏)", value: "3840x2160" },
  { label: "2160×3840 (4K竖屏)", value: "2160x3840" },
  { label: "自动", value: "auto" },
] as const;

/** 质量选项 */
export const QUALITIES = [
  { label: "低", value: "low" },
  { label: "中", value: "medium" },
  { label: "高", value: "high" },
  { label: "自动", value: "auto" },
] as const;

/**
 * base64 → data URL
 *
 * 上游返回的 base64 可能带也可能不带 `data:image/png;base64,` 前缀。
 * 此函数确保结果始终是完整的 data URL。
 *
 * @param b64 - 原始 base64 字符串（可能已包含前缀）
 * @param format - MIME 类型，默认 image/png
 */
export function dataUrlFromB64(b64: string, format = "image/png"): string {
  const raw = b64.includes("base64,") ? b64.split("base64,")[1] : b64;
  return `data:${format};base64,${raw}`;
}

/** 保存到相册（移动端用 Web Share API，桌面端 fallback 下载） */
export async function saveToAlbum(src: string, filename = "image.png") {
  try {
    const res = await fetch(src);
    const blob = await res.blob();
    const file = new File([blob], filename, { type: blob.type || "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: "保存图片" });
      return;
    }
  } catch {
    // 用户取消分享或 canShare 不支持
  }
  // fallback：创建 <a> 标签触发下载
  const a = document.createElement("a");
  a.href = src;
  a.download = filename;
  a.click();
}

/** 检测移动端是否支持 Web Share API 保存图片 */
export function canSaveToAlbum(): boolean {
  return typeof navigator !== "undefined" && "share" in navigator;
}

/**
 * 从图片路径生成缩略图路径
 *
 * 命名约定：原图 /uploads/history/xxx_0.png →
 * 缩略图 /uploads/history/xxx_0_thumb.png
 * 在 HistoryPanel 中使用，缩略图 256px 宽（sharp 生成），~35KB。
 */
export function getThumbSrc(src: string): string {
  return src.replace(/(\.[^.]+)$/, '_thumb$1');
}

