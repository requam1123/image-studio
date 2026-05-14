"use client";

/**
 * 大图预览弹窗
 *
 * 全屏 modal，展示图片大图 + 复制 / 下载 / 设为参考图操作按钮。
 * 点击遮罩或 X 关闭。
 *
 * 作为通用组件被多处使用：
 * - ImageGenerator 结果预览
 * - ImageEditor 结果预览 & 原图预览
 * - HistoryPanel 的历史图片大图查看
 * - RecentResults 的图片预览
 *
 * onUseAsRef 由调用方传入闭包，点击后发射 CustomEvent 或直接调用，
 * 让另一个 Tab 接收到该图片作为参考图。
 */

import { X, Download, Copy, Check, ImagePlus } from "lucide-react";
import { useState, useEffect } from "react";
import { canSaveToAlbum } from "@/lib/api";

interface Props {
  src: string;          // 图片 URL（可以是 /uploads/xxx.png 或 data:image/png;base64,...）
  alt?: string;         // alt 文本
  onClose: () => void;  // 关闭回调
  onDownload?: () => void;   // 下载/保存到相册
  onUseAsRef?: () => void;   // "作为参考图"回调
}

export default function ImagePreview({ src, alt, onClose, onDownload, onUseAsRef }: Props) {
  const [copied, setCopied] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => { setIsMobile(canSaveToAlbum()); }, []);

  /** 复制图片到剪贴板：优先二进制格式（保留原始图片），fallback 文字 URL */
  async function handleCopy() {
    try {
      const res = await fetch(src);
      const blob = await res.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob }),
      ]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      try {
        await navigator.clipboard.writeText(src);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {}
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}           // 点击遮罩关闭
    >
      <div
        className="relative max-w-[90vw] max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}   // 阻止点击图片区域冒泡到遮罩
      >
        {/* 顶部操作栏：作为参考 → 下载/保存到相册 → 复制 → 关闭 */}
        <div className="flex items-center justify-end gap-2 pb-2">
          {onUseAsRef && (
            <button
              onClick={() => { onUseAsRef(); onClose(); }}
              className="bg-white/90 hover:bg-white text-indigo-600 rounded-lg px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 shadow transition-all"
            >
              <ImagePlus size={12} />
              作为参考
            </button>
          )}
          {onDownload && (
            <button
              onClick={onDownload}
              className="bg-white/90 hover:bg-white text-slate-700 rounded-lg px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 shadow transition-all"
            >
              <Download size={12} />
              {isMobile ? "保存到相册" : "下载"}
            </button>
          )}
          <button
            onClick={handleCopy}
            className="bg-white/90 hover:bg-white text-slate-700 rounded-lg px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 shadow transition-all"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? "已复制" : "复制"}
          </button>
          <button
            onClick={onClose}
            className="bg-white/90 hover:bg-white text-slate-700 rounded-lg p-1.5 shadow transition-all"
          >
            <X size={14} />
          </button>
        </div>
        {/* 图片：最大 85vh，object-contain 保持比例，圆角 + 阴影 */}
        <img
          src={src}
          alt={alt || "预览"}
          className="max-w-full max-h-[85vh] object-contain rounded-2xl shadow-2xl"
        />
      </div>
    </div>
  );
}
