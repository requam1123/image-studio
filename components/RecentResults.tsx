"use client";

/**
 * 最近记录组件
 *
 * 在 ImageGenerator / ImageEditor 下方展示最近 5 条已完成的历史记录。
 * 每 30 秒自动刷新，展示全图（不用缩略图）。
 *
 * props.type 控制只显示生成或编辑类型。
 * 支持：预览、下载、复制、设为参考图。
 *
 * 与 HistoryPanel 的差异：
 * - 内嵌在页面上（不是侧面板）
 * - 显示全图（不是缩略图 56×56）
 * - 只显示最近 5 条
 */

import { useState, useEffect } from "react";
import { Eye, Download, Copy, Check, ImagePlus } from "lucide-react";
import { dataUrlFromB64, saveToAlbum, canSaveToAlbum } from "@/lib/api";
import { loadHistory, type HistoryItem } from "@/lib/history";
import ImagePreview from "./ImagePreview";

const MAX_RECORDS = 5;

export default function RecentResults({ type, onUseAsRef }: { type: "generate" | "edit"; onUseAsRef?: (src: string) => void }) {
  const [records, setRecords] = useState<HistoryItem[]>([]);
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => { setIsMobile(canSaveToAlbum()); }, []);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [previewUseAsRef, setPreviewUseAsRef] = useState<(() => void) | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  /** 从 history API 加载最近记录 */
  function load() {
    loadHistory().then((hist) => {
      setRecords(hist.filter((h) => h.type === type && h.status !== "failed").slice(0, MAX_RECORDS));
    });
  }

  useEffect(() => { load(); }, []);
  // 每 30 秒自动刷新
  useEffect(() => { const id = setInterval(load, 30000); return () => clearInterval(id); }, []);

  async function handleCopy(src: string, id: string) {
    try {
      const res = await fetch(src);
      const blob = await res.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    } catch {
      await navigator.clipboard.writeText(src);
    }
    setCopiedIdx(id);
    setTimeout(() => setCopiedIdx(null), 2000);
  }

  /** 从 HistoryItem 提取图片源列表 */
  function toSrc(r: HistoryItem): string[] {
    const srcs: string[] = [];
    if (r.imagesFilePath && r.imagesFilePath.length > 0) srcs.push(...r.imagesFilePath);
    else if (r.filePath) srcs.push(r.filePath);
    else if (r.imagesB64 && r.imagesB64.length > 0) r.imagesB64.forEach(b => srcs.push(dataUrlFromB64(b)));
    else if (r.b64) srcs.push(dataUrlFromB64(r.b64));
    return srcs;
  }

  const count = records.length;

  return (
    <div className="space-y-3 animate-fade-in">
      <div className="flex items-center justify-between">
        <button onClick={() => setCollapsed(!collapsed)} className="flex items-center gap-2 text-sm font-medium text-slate-700 hover:text-slate-900">
          <span>最近 {MAX_RECORDS} 次记录</span>
          <span className="text-xs text-slate-400 font-normal">({count})</span>
          <span className="text-xs text-slate-400">{collapsed ? "展开" : "收起"}</span>
        </button>
      </div>

      {!collapsed && count === 0 && (
        <div className="glass rounded-xl p-6 text-center text-xs text-slate-400">
          暂无记录，生成图片后将自动显示
        </div>
      )}

      {!collapsed && count > 0 && (
        <div className="space-y-3">
          {records.map((rec) => (
            <div key={rec.id} className="glass rounded-xl overflow-hidden">
              <div className="px-3 py-2 border-b border-white/20 flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <p className="text-xs text-slate-600 truncate"><span className="text-slate-400">提示词：</span>{rec.prompt}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {rec.duration != null ? (
                    <span className="text-[10px] text-slate-400">{rec.duration}s</span>
                  ) : (
                    <span className="text-[10px] text-slate-300">Null</span>
                  )}
                  <span className="text-[10px] text-slate-400">
                    {new Date(rec.timestamp).toLocaleString("zh-CN")}
                  </span>
                </div>
              </div>
              {/* 全图网格展示（最多 4 张） */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-0">
                {toSrc(rec).slice(0, 4).map((src, i) => (
                  <div key={i} className="glass rounded-none border-0 group relative cursor-pointer"
                    onClick={() => { setPreviewSrc(src); if (onUseAsRef) setPreviewUseAsRef(() => () => onUseAsRef(src)); }}>
                    <img src={src} alt="" className="w-full h-auto object-cover" loading="lazy" />
                    {/* hover 操作栏 */}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                      <button onClick={(e) => { e.stopPropagation(); setPreviewSrc(src); if (onUseAsRef) setPreviewUseAsRef(() => () => onUseAsRef(src)); }}
                        className="bg-white/90 hover:bg-white text-slate-700 rounded-xl px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 shadow-lg"><Eye size={12} />预览</button>
                      <button onClick={(e) => { e.stopPropagation(); saveToAlbum(src, `recent-${rec.id}-${i}.png`); }}
                        className="bg-white/90 hover:bg-white text-slate-700 rounded-xl px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 shadow-lg"><Download size={12} />{isMobile ? "保存到相册" : "下载"}</button>
                      <button onClick={(e) => { e.stopPropagation(); handleCopy(src, `${rec.id}-${i}`); }}
                        className="bg-white/90 hover:bg-white text-slate-700 rounded-xl px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 shadow-lg">
                        {copiedIdx === `${rec.id}-${i}` ? <Check size={12} /> : <Copy size={12} />}{copiedIdx === `${rec.id}-${i}` ? "已复制" : "复制"}
                      </button>
                      {onUseAsRef && <button onClick={(e) => { e.stopPropagation(); onUseAsRef(src); }}
                        className="bg-white/90 hover:bg-white text-indigo-600 rounded-xl px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 shadow-lg"><ImagePlus size={12} />作为参考</button>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 大图预览弹窗 */}
      {previewSrc && (
        <ImagePreview
          src={previewSrc}
          alt="图片预览"
          onClose={() => { setPreviewSrc(null); setPreviewUseAsRef(null); }}
          onDownload={() => saveToAlbum(previewSrc, `recent-${Date.now()}.png`)}
          onUseAsRef={previewUseAsRef || undefined}
        />
      )}
    </div>
  );
}
