"use client";

/**
 * 图片编辑器组件
 *
 * 与 ImageGenerator 共享同一套轮询 / localStorage 模式，差异：
 * - 需上传源图片（拖拽或点击选择）
 * - 发送 JSON 格式请求（image 字段传 base64）
 * - 结果区域显示"编辑前"原图对比
 * - 尺寸选项不同（EDIT_SIZES 多了 "auto" 模式）
 */

import { useState, useEffect, useRef, type FormEvent, type DragEvent } from "react";
import {
  Upload,
  Loader2,
  Download,
  Wand2,
  X,
  Copy,
  Check,
  Eye,
  ImagePlus,
  Trash2,
} from "lucide-react";
import { dataUrlFromB64, saveToAlbum, canSaveToAlbum } from "@/lib/api";
import RecentResults from "./RecentResults";
import ImagePreview from "./ImagePreview";

const EDIT_SIZES = [
  { label: "自动 (保留原尺寸)", value: "auto" },
  { label: "1024×1024", value: "1024x1024" },
  { label: "1536×1024 (横屏)", value: "1536x1024" },
  { label: "1024×1536 (竖屏)", value: "1024x1536" },
  { label: "2048×2048 (2K)", value: "2048x2048" },
  { label: "2048×1152 (2K横屏)", value: "2048x1152" },
  { label: "3840×2160 (4K横屏)", value: "3840x2160" },
  { label: "2160×3840 (4K竖屏)", value: "2160x3840" },
] as const;

const COUNTS = [1, 2, 3, 4, 5] as const;

/** 单张图片的任务状态 */
interface JobItem {
  id: number;
  status: "loading" | "done" | "error";
  b64?: string;
  error?: string;
  duration?: number;
  usage?: { total: number; input: number; output: number };
}

/** 当前进行中的编辑任务（额外保存原图用于对比） */
interface ActiveTask {
  taskId: string;
  status: string;
  jobs: JobItem[];
  originalB64: string | null;
}

/** 从 localStorage 读取字符串值 */
function loadLSText(key: string, fallback = ""): string {
  if (typeof window === "undefined") return fallback;
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}
function saveLS(key: string, val: string) {
  try { localStorage.setItem(key, val); } catch { /* quota */ }
}

export default function ImageEditor() {
  // ── 表单状态 ──
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);        // 用 URL.createObjectURL 生成临时预览
  const [prompt, setPrompt] = useState(loadLSText("edit_prompt"));
  const [size, setSize] = useState(loadLSText("edit_size", "auto"));
  const [count, setCount] = useState(() => {
    const c = loadLSText("edit_count");
    const n = parseInt(c, 10);
    return (n >= 1 && n <= 5) ? n : 1;
  });

  const [activeTask, setActiveTask] = useState<ActiveTask | null>(null);
  const [originalB64, setOriginalB64] = useState<string | null>(null);  // 原图 base64（发给后端 / 对比展示）
  const [dragOver, setDragOver] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);

  // ── 耗时计时器 ──
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!activeTask || activeTask.status === "completed" || activeTask.status === "failed") {
      setElapsed(0); return;
    }
    const id = setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [activeTask?.taskId, activeTask?.status]);

  const [originalPreview, setOriginalPreview] = useState(false);      // 原图大图预览
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const currentTaskRef = useRef<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => { setIsMobile(canSaveToAlbum()); }, []);

  // 同步 localStorage 到 prompt（防止浏览器表单恢复导致 React 状态不同步）
  useEffect(() => {
    const saved = loadLSText("edit_prompt");
    if (saved && saved !== prompt) setPrompt(saved);
    // 兜底：如果 localStorage 为空但 textarea 实际有内容，直接用 DOM 值
    if (!saved && !prompt) {
      const el = document.querySelector<HTMLTextAreaElement>(`textarea[placeholder*="描述你想要如何编辑"]`);
      if (el && el.value) setPrompt(el.value);
    }
  }, []);

  // ── localStorage 持久化 ──
  useEffect(() => {
    saveLS("edit_prompt", prompt);
    saveLS("edit_size", size);
    saveLS("edit_count", String(count));
  }, [prompt, size, count]);

  // 组件卸载时清理 object URL
  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  // ── 页面加载时恢复未完成的编辑任务 ──
  useEffect(() => {
    fetch("/api/tasks")
      .then((r) => r.json())
      .then((data) => {
        const tasks = data.tasks || [];
        const active = tasks.find(
          (t: any) => (t.status === "processing" || t.status === "pending") && t.type === "edit"
        );
        if (active) {
          const placeholderJobs: JobItem[] = Array.from(
            { length: active.count || 1 },
            (_, i) => ({ id: Date.now() + i, status: "loading" as const })
          );
          currentTaskRef.current = active.taskId;
          setActiveTask({ taskId: active.taskId, status: active.status, jobs: placeholderJobs, originalB64: null });
          pollTask(active.taskId);
        }
      }).catch(() => {});
  }, []);

  const loadingMessages = [
    "先去刷一会B站吧～","泡杯咖啡等一下～","数到十就好了…大概吧",
    "AI 正在努力搓图ing","建议伸个懒腰再回来","去喝口水吧，快好了",
    "像素正在排队生成中","莫急，好图需要时间","这张图值得等待 ✨","AI 说它在认真画画",
  ];
  const [msg] = useState(() => loadingMessages[Math.floor(Math.random() * loadingMessages.length)]);

  // ── 文件 ──

  /** File 对象 → base64（去掉 data:image/...;base64, 前缀） */
  function readFileAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /** 选择文件后：设预览、读 base64、清除上次任务 */
  async function handleFile(f: File) {
    if (!f.type.startsWith("image/")) return;
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const url = URL.createObjectURL(f);
    previewUrlRef.current = url;
    setFile(f);
    setPreview(url);
    setOriginalB64(await readFileAsBase64(f));
    setActiveTask(null);
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }
  function handleDragOver(e: DragEvent) { e.preventDefault(); setDragOver(true); }
  function handleDragLeave() { setDragOver(false); }

  function clearFile() {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setFile(null);
    setPreview(null);
    setActiveTask(null);
    setOriginalB64(null);
  }

  // ── 图片操作 ──

  async function handleCopy(b64: string, idx: number) {
    try {
      const res = await fetch(dataUrlFromB64(b64));
      const blob = await res.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    } catch {
      await navigator.clipboard.writeText(dataUrlFromB64(b64));
    }
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  }

  /** 将编辑结果作为参考图发送给生成器 Tab */
  function handleUseAsRef(b64: string) {
    window.dispatchEvent(new CustomEvent("imageUseAsRef", { detail: dataUrlFromB64(b64) }));
  }

  async function useAsRefFromRecent(src: string) {
    window.dispatchEvent(new CustomEvent("imageUseAsRef", { detail: src }));
  }

  // ── 轮询 ──

  async function pollTask(taskId: string) {
    while (currentTaskRef.current === taskId) {
      const res = await fetch(`/api/tasks/${taskId}`);
      if (!res.ok) { await new Promise((r) => setTimeout(r, 2000)); continue; }
      const data = await res.json();

      // 有 results 时增量渲染
      if (data.results && data.results.some((r: any) => r?.b64 || r?.error)) {
        setActiveTask((prev) => prev ? {
          ...prev,
          status: data.status,
          jobs: (data.results || []).map((r: any, i: number) => ({
            id: Date.now() + i,
            status: r?.b64 ? "done" as const : r?.error ? "error" as const : "loading" as const,
            b64: r?.b64,
            error: r?.error,
            duration: r?.duration,
            usage: r?.usage,
          })),
        } : null);
      }

      if (data.status === "completed") {
        if (currentTaskRef.current === taskId) currentTaskRef.current = null;
        setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
        return;
      }

      if (data.status === "failed") {
        if (currentTaskRef.current === taskId) currentTaskRef.current = null;
        setActiveTask((prev) => prev ? { ...prev, status: "failed" } : prev);
        return;
      }

      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  // ── 提交表单 ──

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file || !prompt.trim() || (activeTask && activeTask.status !== "completed" && activeTask.status !== "failed")) return;

    const placeholderJobs: JobItem[] = Array.from({ length: count }, (_, i) => ({
      id: Date.now() + i,
      status: "loading" as const,
    }));
    const tempId = `temp-${Date.now()}`;
    setActiveTask({ taskId: tempId, status: "pending", jobs: placeholderJobs, originalB64 });
    setPreviewIdx(null);

    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "edit",
          prompt: prompt.trim(),
          size,
          count,
          image: originalB64,                              // 前端已转为 base64
        }),
      });
      const { taskId } = await res.json();

      currentTaskRef.current = taskId;
      setActiveTask((prev) => prev?.taskId === tempId ? { taskId, status: "pending", jobs: placeholderJobs, originalB64 } : prev);
      pollTask(taskId);
    } catch (err) {
      setActiveTask({
        taskId: "error",
        status: "failed",
        jobs: [{ id: Date.now(), status: "error", error: String(err) }],
        originalB64,
      });
    }
  }

  const jobs = activeTask?.jobs || [];

  // ── 渲染 ──
  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} autoComplete="off" className="glass rounded-2xl p-6 space-y-4">
        {/* Image upload */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">上传图片</label>
          {preview ? (
            <div className="relative rounded-xl overflow-hidden">
              <img src={preview} alt="预览" className="w-full max-h-64 object-contain bg-slate-100" />
              <button type="button" onClick={clearFile}
                className="absolute top-2 right-2 bg-white/80 hover:bg-white rounded-full p-1.5 shadow transition-all" aria-label="清除图片">
                <X size={14} className="text-slate-600" />
              </button>
            </div>
          ) : (
            <div onClick={() => inputRef.current?.click()} onDrop={handleDrop}
              onDragOver={handleDragOver} onDragLeave={handleDragLeave}
              role="button" tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
              aria-label="点击或拖拽上传图片"
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                dragOver ? "border-indigo-400 bg-indigo-50" : "border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/30"}`}>
              <input ref={inputRef} type="file" accept="image/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              <Upload size={32} className="mx-auto mb-2 text-slate-400" />
              <p className="text-sm text-slate-500">点击或拖拽上传图片</p>
              <p className="text-xs text-slate-400 mt-1">支持 PNG、JPG 等格式</p>
            </div>
          )}
        </div>

        {/* Prompt */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">编辑描述 (Prompt)</label>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)}
            placeholder="描述你想要如何编辑图片，例如：戴上眼镜" rows={2} autoComplete="off"
            className="w-full rounded-xl border border-slate-200 bg-white/60 px-4 py-3 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent resize-none transition-all" />
        </div>

        {/* Size & Count */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">尺寸 (Size)</label>
            <select value={size} onChange={(e) => setSize(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white/60 px-4 py-2.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent">
              {EDIT_SIZES.map((s) => (<option key={s.value} value={s.value}>{s.label}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">生成数量</label>
            <select value={count} onChange={(e) => setCount(Number(e.target.value))}
              className="w-full rounded-xl border border-slate-200 bg-white/60 px-4 py-2.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent">
              {COUNTS.map((n) => (<option key={n} value={n}>{n} 张</option>))}
            </select>
          </div>
        </div>

        <div className="flex gap-2">
          <button type="submit" disabled={(activeTask && activeTask.status !== "completed" && activeTask.status !== "failed") || !file || !prompt.trim()}
            className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white rounded-xl py-3 text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed">
            {activeTask && activeTask.status !== "completed" && activeTask.status !== "failed" ? <><Loader2 size={16} className="animate-spin" />编辑中...</> : <><Wand2 size={16} />编辑图片</>}
          </button>
          <button type="button" onClick={() => {
            setPrompt(""); setSize("auto"); setCount(1);
            saveLS("edit_prompt", ""); saveLS("edit_size", "auto"); saveLS("edit_count", "1");
          }}
            className="shrink-0 flex items-center gap-1.5 text-xs text-slate-500 hover:text-red-600 bg-white border border-slate-200 hover:border-red-300 rounded-xl px-4 py-3 transition-all"
            title="清除提示词">
            <Trash2 size={14} />清除
          </button>
        </div>
      </form>

      {/* Result cards */}
      {jobs.length > 0 && (
        <div ref={resultRef} className="space-y-3 animate-fade-in">
          <h2 className="text-sm font-medium text-slate-700">编辑结果</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* 原图对比 */}
            {activeTask?.originalB64 && activeTask.status === "completed" && (
              <div className="glass rounded-2xl overflow-hidden">
                <div className="px-3 py-1.5 border-b border-white/20">
                  <span className="text-xs font-medium text-slate-500">编辑前</span>
                </div>
                <img src={dataUrlFromB64(activeTask.originalB64)} alt="编辑前"
                  className="w-full h-auto object-cover cursor-pointer"
                  onClick={() => setOriginalPreview(true)} />
              </div>
            )}

            {jobs.map((job, i) => (
              <div key={job.id} className="glass rounded-2xl overflow-hidden">
                <div className="px-3 py-1.5 border-b border-white/20 flex items-center justify-between">
                  <span className="text-xs font-medium text-indigo-500"># {i + 1}</span>
                  {job.duration != null && <span className="text-[10px] text-slate-400">{job.duration}s</span>}
                </div>
                {job.status === "loading" && (
                  <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-2">
                    <Loader2 size={20} className="animate-spin text-indigo-400" />
                    <span className="text-xs">{msg}</span>
                    {elapsed > 0 && <span className="text-[10px] text-slate-300">{elapsed}s</span>}
                  </div>
                )}
                {job.status === "error" && (
                  <div className="flex flex-col items-center justify-center py-12 text-red-400 gap-1 px-4 text-center">
                    <p className="text-xs font-medium">失败</p>
                    <p className="text-[10px] text-red-300 break-all">{job.error}</p>
                  </div>
                )}
                {job.status === "done" && job.b64 && (
                  <div className="group relative">
                    <img src={dataUrlFromB64(job.b64)} alt={`编辑结果 ${i + 1}`}
                      className="w-full h-auto object-cover cursor-pointer"
                      onClick={() => setPreviewIdx(i)} />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                      <button onClick={() => setPreviewIdx(i)}
                        className="bg-white/90 hover:bg-white text-slate-700 rounded-xl px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 shadow-lg"><Eye size={12} />预览</button>
                      <button onClick={() => saveToAlbum(dataUrlFromB64(job.b64!), `edited-${Date.now()}.png`)}
                        className="bg-white/90 hover:bg-white text-slate-700 rounded-xl px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 shadow-lg"><Download size={12} />{isMobile ? "保存到相册" : "下载"}</button>
                      <button onClick={() => handleCopy(job.b64!, i)}
                        className="bg-white/90 hover:bg-white text-slate-700 rounded-xl px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 shadow-lg">
                        {copiedIdx === i ? <Check size={12} /> : <Copy size={12} />}{copiedIdx === i ? "已复制" : "复制"}
                      </button>
                      <button onClick={() => handleUseAsRef(job.b64!)}
                        className="bg-white/90 hover:bg-white text-indigo-600 rounded-xl px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 shadow-lg"><ImagePlus size={12} />作为参考</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <RecentResults type="edit" onUseAsRef={useAsRefFromRecent} />

      {/* 结果大图预览 */}
      {previewIdx !== null && jobs[previewIdx]?.b64 && (
        <ImagePreview
          src={dataUrlFromB64(jobs[previewIdx].b64!)}
          alt="编辑结果预览"
          onClose={() => setPreviewIdx(null)}
          onDownload={() => saveToAlbum(dataUrlFromB64(jobs[previewIdx].b64!), `edited-${Date.now()}.png`)}
          onUseAsRef={() => { handleUseAsRef(jobs[previewIdx].b64!); setPreviewIdx(null); }}
        />
      )}

      {/* 原图大图预览 */}
      {originalPreview && activeTask?.originalB64 && (
        <ImagePreview
          src={dataUrlFromB64(activeTask.originalB64!)}
          alt="原始图片预览"
          onClose={() => setOriginalPreview(false)}
          onDownload={() => saveToAlbum(dataUrlFromB64(activeTask.originalB64!), `original-${Date.now()}.png`)}
          onUseAsRef={() => { handleUseAsRef(activeTask.originalB64!); setOriginalPreview(false); }}
        />
      )}
    </div>
  );
}
