"use client";

/**
 * 历史记录侧面板
 *
 * 右侧滑出面板，展示历史图片列表（缩略图 56×56）。
 * 支持：点开大图预览、展开详情、单条/批量删除、设为参考图。
 *
 * 缩略图策略：
 * - HistoryPanel 用缩略图（_thumb.png，256px，~35KB）
 * - RecentResults 用全图（列表展示）
 * 详见 ThumbnailImg 组件的 onError 回退逻辑。
 */

import { useState, useEffect, useRef } from "react";
import { Clock, Trash2, Eye, Download, Image, Wand2, X, ImageIcon, Loader2 } from "lucide-react";
import Button from "@/components/ui/Button";
import {
  loadHistory,
  loadHistoryPage,
  deleteHistoryItem,
  getHistoryItem,
  type HistoryItem,
} from "@/lib/history";
import { dataUrlFromB64, saveToAlbum, getThumbSrc } from "@/lib/api";
import ImagePreview from "./ImagePreview";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function HistoryPanel({ open, onClose }: Props) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 面板打开时加载第一页
  useEffect(() => {
    if (!open) return;
    setOffset(0);
    setItems([]);
    loadHistoryPage(0, 30).then((page) => {
      setItems(page.items);
      setTotal(page.total);
      setOffset(page.offset + page.limit);
      setHasMore(page.hasMore);
    });
  }, [open]);

  async function loadMore() {
    if (loading || !hasMore) return;
    setLoading(true);
    const page = await loadHistoryPage(offset, 30);
    setItems((prev) => [...prev, ...page.items]);
    setOffset(page.offset + page.limit);
    setHasMore(page.hasMore);
    setLoading(false);
  }

  async function refresh() {
    const page = await loadHistoryPage(0, 30);
    setItems(page.items);
    setTotal(page.total);
    setOffset(page.offset + page.limit);
    setHasMore(page.hasMore);
  }

  async function handleDelete(id: string) {
    await deleteHistoryItem(id);
    await refresh();
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function cancelSelect() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  async function handleBatchDelete() {
    await Promise.all(Array.from(selectedIds).map(deleteHistoryItem));
    setSelectedIds(new Set());
    setSelectMode(false);
    await refresh();
  }

  return (
    <div
      className={`fixed inset-0 z-40 transition-all ${
        open ? "visible opacity-100" : "invisible opacity-0"
      }`}
    >
      {/* 背景遮罩 */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* 侧面板 */}
      <div
        className={`absolute right-0 top-0 h-full w-full max-w-md bg-white/95 backdrop-blur-xl shadow-2xl border-l border-white/30 transition-transform ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* 头部：标题 + 删除/关闭按钮 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Clock size={16} className="text-slate-500" />
            <h2 className="text-sm font-semibold text-slate-700">历史记录</h2>
            <span className="text-xs text-slate-400">({items.length})</span>
          </div>
          <div className="flex items-center gap-2">
            {items.length > 0 && !selectMode && (
              <Button variant="danger" icon={<Trash2 size={12} />} onClick={() => setSelectMode(true)}>
                删除
              </Button>
            )}
            {selectMode && (
              <>
                <Button variant="danger" icon={<Trash2 size={12} />}
                  onClick={handleBatchDelete}
                  disabled={selectedIds.size === 0}>
                  删除 {selectedIds.size > 0 ? `(${selectedIds.size})` : ""}
                </Button>
                <Button variant="text" onClick={cancelSelect}>取消</Button>
              </>
            )}
            {!selectMode && (
              <Button variant="icon" onClick={onClose}><X size={16} /></Button>
            )}
          </div>
        </div>

        {/* 列表区域 */}
        <div ref={scrollRef} className="h-full pb-20 overflow-y-auto scrollbar-hide">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
              <Clock size={32} className="mb-2" />
              <p className="text-sm">暂无历史记录</p>
            </div>
          ) : (
            <div className="px-4 py-3 space-y-3">
              {items.map((item) => (
                <HistoryCard
                  key={item.id}
                  item={item}
                  onDelete={() => handleDelete(item.id)}
                  onPreview={setPreviewSrc}
                  selectMode={selectMode}
                  selected={selectedIds.has(item.id)}
                  onToggle={() => toggleSelect(item.id)}
                />
              ))}
              {/* 查看更多按钮 */}
              {hasMore && (
                <div className="flex justify-center pt-2 pb-4">
                  <button
                    onClick={loadMore}
                    disabled={loading}
                    className="text-xs text-indigo-500 hover:text-indigo-700 font-medium px-6 py-2 rounded-xl border border-indigo-200 hover:border-indigo-400 bg-white/60 hover:bg-white transition-all disabled:opacity-40"
                  >
                    {loading ? "加载中..." : "查看更多"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 大图预览弹窗 */}
      {previewSrc && (
        <ImagePreview
          src={previewSrc}
          alt="历史图片预览"
          onClose={() => setPreviewSrc(null)}
          onDownload={() => saveToAlbum(previewSrc, `history-${Date.now()}.png`)}
          onUseAsRef={() => { window.dispatchEvent(new CustomEvent("imageUseAsRef", { detail: previewSrc })); }}
        />
      )}
    </div>
  );
}

/**
 * 缩略图组件
 *
 * 优先加载 256px 缩略图（_thumb.png），
 * 加载失败回退到原图，防止缩略图不存在时显示裂图。
 */
function ThumbnailImg({ src, alt, className, onPreview }: { src: string; alt: string; className?: string; onPreview?: () => void }) {
  const thumbSrc = getThumbSrc(src);   // /uploads/history/xxx_0.png → /uploads/history/xxx_0_thumb.png
  return (
    <img
      src={thumbSrc}
      alt={alt}
      className={className}
      onClick={onPreview}
      loading="lazy"
      onError={(e) => { (e.target as HTMLImageElement).src = src; }}
    />
  );
}

/**
 * 单条历史记录卡片
 *
 * 显示：缩略图（最多 4 张）、类型标签（生成/编辑）、提示词、尺寸、质量、Token、时间、操作按钮。
 * 点击"详情"展开更多信息（模型、质量、参考图等），通过 GET /api/history?id=xxx 懒加载详情。
 */
function HistoryCard({
  item,
  onDelete,
  onPreview,
  selectMode,
  selected,
  onToggle,
}: {
  item: HistoryItem;
  onDelete: () => void;
  onPreview: (src: string) => void;
  selectMode?: boolean;
  selected?: boolean;
  onToggle?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<{ refImages?: string[]; promptFull?: string } | null>(null);

  // 展开时才加载详情（懒加载）
  useEffect(() => {
    if (expanded && !detail) {
      fetch("/api/history?id=" + encodeURIComponent(item.id)).then(r => r.json()).then(d => {
        if (d && d.item) setDetail({ refImages: d.item.refImages, promptFull: d.item.prompt });
      }).catch((e) => {
        console.error("Failed to load history detail:", e);
      });
    }
  }, [expanded]);

  // 构建图片源列表：优先 filePath（文件路径），其次 b64
  const sources: { src: string; isB64: boolean }[] = [];
  if (item.imagesFilePath && item.imagesFilePath.length > 0) {
    for (const fp of item.imagesFilePath) sources.push({ src: fp, isB64: false });
  } else if (item.filePath) {
    sources.push({ src: item.filePath, isB64: false });
  } else if (item.imagesB64 && item.imagesB64.length > 0) {
    for (const b of item.imagesB64) sources.push({ src: dataUrlFromB64(b), isB64: true });
  } else if (item.b64) {
    sources.push({ src: dataUrlFromB64(item.b64), isB64: true });
  }

  return (
    <div
      className={`glass rounded-xl overflow-hidden ${selectMode ? "cursor-pointer" : ""}`}
      onClick={selectMode ? onToggle : undefined}
    >
      {/* 多选勾选框 */}
      {selectMode && (
        <div className="absolute ml-3 mt-3 z-10">
          <input type="checkbox" checked={selected} readOnly
            className="w-4 h-4 rounded border-slate-300 text-indigo-500 focus:ring-indigo-400" />
        </div>
      )}
      {/* 缩略图 + 摘要 */}
      <div className="flex gap-3 p-3">
        <div className="shrink-0 flex gap-1">
          {sources.slice(0, 4).map((s, i) => (
            <div key={i}
              className="w-14 h-14 rounded-lg border border-slate-200 overflow-hidden bg-slate-50 flex items-center justify-center">
              <ThumbnailImg src={s.src} alt="" className="w-full h-full object-cover cursor-pointer"
                onPreview={() => onPreview(s.src)} />
            </div>
          ))}
        </div>
        <div className="flex-1 min-w-0">
          {/* 类型标签 + 时间 + 耗时 */}
          <div className="flex items-center gap-1.5 mb-1">
            <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${
              item.type === "generate" ? "bg-indigo-50 text-indigo-600" : "bg-purple-50 text-purple-600"}`}>
              {item.type === "generate" ? <Image size={10} /> : <Wand2 size={10} />}
              {item.type === "generate" ? "生成" : "编辑"}
              {item.status === "pending" ? <span className="text-[10px] text-amber-500 ml-1">生成中...</span> :
               item.status === "failed" ? <span className="text-[10px] text-red-400 ml-1">失败</span> : null}
            </span>
            <span className="text-[10px] text-slate-400">
              {new Date(item.timestamp).toLocaleString("zh-CN")}
            </span>
            <span className="text-[10px] text-slate-300">
              {item.duration != null ? `${item.duration}s` : "Null"}
            </span>
          </div>
          <p className="text-xs text-slate-600 truncate"><span className="text-slate-400">提示词：</span>{item.prompt}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] text-slate-400">{item.size}</span>
            {item.quality && <span className="text-[10px] text-slate-400">· 质量: {item.quality}</span>}
            {item.usage && <span className="text-[10px] text-slate-400">· Token: {item.usage.total}</span>}
          </div>
        </div>
        {/* 操作按钮 */}
        <div className="shrink-0 flex flex-col gap-1">
          <button onClick={() => setExpanded(!expanded)}
            className="text-slate-400 hover:text-slate-600 p-0.5 transition-colors" title="详情">
            <Eye size={14} />
          </button>
          {!selectMode && (
            <button onClick={onDelete}
              className="text-slate-400 hover:text-red-500 p-0.5 transition-colors" title="删除">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {/* 展开详情 */}
      {expanded && (
        <div className="px-3 pb-3 pt-0 border-t border-slate-100">
          <div className="mt-2 space-y-1">
            <div className="flex gap-2 text-[11px]">
              <span className="text-slate-400 shrink-0 w-12">提示词:</span>
              <span className="text-slate-600 break-words">{item.prompt}</span>
            </div>
            <div className="flex gap-2 text-[11px]">
              <span className="text-slate-400 shrink-0 w-12">模型:</span>
              <span className="text-slate-600">{item.model}</span>
            </div>
            {item.type === "generate" && item.quality && (
              <div className="flex gap-2 text-[11px]">
                <span className="text-slate-400 shrink-0 w-12">质量:</span>
                <span className="text-slate-600">{item.quality}</span>
              </div>
            )}
            {item.refCount !== undefined && item.refCount > 0 && !detail && (
              <div className="flex gap-2 text-[11px]">
                <span className="text-slate-400 shrink-0 w-12">参考图:</span>
                <Loader2 size={10} className="animate-spin text-slate-400" />
              </div>
            )}
            {item.refCount !== undefined && item.refCount > 0 && detail?.refImages && detail.refImages.length > 0 && (
              <div className="flex gap-2 text-[11px]">
                <span className="text-slate-400 shrink-0 w-12">参考图:</span>
                <span className="text-indigo-500 text-[11px] cursor-pointer hover:underline"
                  onClick={(e) => { e.stopPropagation(); onPreview(dataUrlFromB64(detail.refImages![0])); }}>
                  点击查看（{detail.refImages.length} 张）
                </span>
              </div>
            )}
            {item.type === "edit" && item.originalB64 && (
              <div className="flex gap-2 text-[11px]">
                <span className="text-slate-400 shrink-0 w-12">原图:</span>
                <span className="text-slate-600">已保存</span>
              </div>
            )}
            <div className="flex gap-2 text-[11px]">
              <span className="text-slate-400 shrink-0 w-12">尺寸:</span>
              <span className="text-slate-600">{item.size}</span>
            </div>
            {item.usage && (
              <div className="flex gap-2 text-[11px]">
                <span className="text-slate-400 shrink-0 w-12">Token:</span>
                <span className="text-slate-600">输入 {item.usage.input} / 输出 {item.usage.output}</span>
              </div>
            )}
            <div className="flex gap-2 text-[11px]">
              <span className="text-slate-400 shrink-0 w-12">耗时:</span>
              <span className="text-slate-600">{item.duration != null ? `${item.duration}s` : "Null"}</span>
            </div>
            <div className="flex gap-2 text-[11px]">
              <span className="text-slate-400 shrink-0 w-12">时间:</span>
              <span className="text-slate-600">{new Date(item.timestamp).toLocaleString("zh-CN")}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
