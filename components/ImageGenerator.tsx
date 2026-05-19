"use client";

/**
 * 图片生成器组件（核心）
 *
 * 功能：
 * 1. 表单：提示词、尺寸、质量、数量、参考图片
 * 2. 提交 → POST /api/tasks 创建异步任务
 * 3. pollTask 轮询 GET /api/tasks/:taskId 获取结果
 * 4. 增量渲染：每个请求完成后立即显示图片
 * 5. localStorage 持久化：页面刷新不丢表单状态
 * 6. 页面加载时恢复未完成任务或最近完成的任务
 *
 * 与 ImageEditor 共享同一套 pollTask / localStorage 模式。
 */

import { useState, useEffect, useRef, type FormEvent, type DragEvent } from "react";
import {
  Loader2,
  Sparkles,
  Upload,
  X,
  Copy,
  Check,
  Eye,
  ImagePlus,
  Download,
  Trash2,
} from "lucide-react";
import {
  dataUrlFromB64,
  saveToAlbum,
  canSaveToAlbum,
  SIZES,
  QUALITIES,
} from "@/lib/api";
import RecentResults from "./RecentResults";
import ImagePreview from "./ImagePreview";

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

/** 当前进行中的异步任务 */
interface ActiveTask {
  taskId: string;
  status: string;
  jobs: JobItem[];
}

// localStorage 键名常量
const LS_KEYS = { prompt: "gen_prompt", size: "gen_size", quality: "gen_quality", refs: "gen_refs", count: "gen_count" };

/** 从 localStorage 读取字符串值 */
function loadLSText(key: string, fallback = ""): string {
  if (typeof window === "undefined") return fallback;
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}
/** 从 localStorage 读取参考图数组 */
function loadLSRefs(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LS_KEYS.refs);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
/** 保存字符串到 localStorage */
function saveLS(key: string, val: string) {
  try { localStorage.setItem(key, val); } catch { /* quota */ }
}
/** 保存参考图数组到 localStorage */
function saveLSRefs(refs: string[]) {
  try { localStorage.setItem(LS_KEYS.refs, JSON.stringify(refs)); } catch { /* quota */ }
}

export default function ImageGenerator() {
  // ── 表单状态（从 localStorage 恢复） ──
  const [prompt, setPrompt] = useState(loadLSText(LS_KEYS.prompt));
  const [size, setSize] = useState(loadLSText(LS_KEYS.size, "auto"));
  const [quality, setQuality] = useState(loadLSText(LS_KEYS.quality, "auto"));
  const [count, setCount] = useState(() => {
    const c = loadLSText(LS_KEYS.count);
    const n = parseInt(c, 10);
    return (n >= 1 && n <= 5) ? n : 1;
  });

  const [activeTask, setActiveTask] = useState<ActiveTask | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);              // 结果区域滚动锚点

  const [refImages, setRefImages] = useState<string[]>(loadLSRefs);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const refSectionRef = useRef<HTMLDivElement>(null);

  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => { setIsMobile(canSaveToAlbum()); }, []);

  const currentTaskRef = useRef<string | null>(null);          // 当前正在轮询的任务 ID
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // ── 跨组件通信：监听 "imageUseAsRef" 事件 ──
  // HistoryPanel / RecentResults / ImageEditor 使用此事件传图片到生成器
  useEffect(() => {
    const handler = (e: Event) => { const ce = e as CustomEvent; useAsRefFromRecent(ce.detail); };
    window.addEventListener("imageUseAsRef", handler);
    return () => window.removeEventListener("imageUseAsRef", handler);
  }, []);

  // ── 自动保存表单状态到 localStorage ──
  // debounced 300ms，避免每次输入都写磁盘
  useEffect(() => {
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveLS(LS_KEYS.prompt, prompt);
      saveLS(LS_KEYS.size, size);
      saveLS(LS_KEYS.quality, quality);
      saveLS(LS_KEYS.count, String(count));
      saveLSRefs(refImages);
    }, 300);
    return () => clearTimeout(saveTimerRef.current);
  }, [prompt, size, quality, count, refImages]);

  // ── 同步 localStorage 到 prompt 状态（处理浏览器表单恢复导致的 React 状态不同步）
  useEffect(() => {
    const saved = loadLSText(LS_KEYS.prompt);
    if (saved && saved !== prompt) setPrompt(saved);
  }, []);

  // ── 页面加载时恢复任务 ──
  // 从 GET /api/tasks 获取最近 20 条任务，优先恢复处理中的，其次展示最近完成的
  useEffect(() => {
    fetch("/api/tasks")
      .then((r) => r.json())
      .then((data) => {
        const tasks = data.tasks || [];
        const active = tasks.find((t: any) => t.status === "processing" || t.status === "pending");
        if (active) {
          const placeholderJobs: JobItem[] = Array.from(
            { length: active.count || 1 },
            (_, i) => ({ id: Date.now() + i, status: "loading" as const })
          );
          currentTaskRef.current = active.taskId;
          setActiveTask({ taskId: active.taskId, status: active.status, jobs: placeholderJobs });
          pollTask(active.taskId);
          return;
        }
        // 最近的 completed 任务（5 分钟内）
        const recent = tasks.find(
          (t: any) => t.status === "completed" && t.completedAt && Date.now() - t.completedAt < 300000
        );
        if (recent) {
          fetch(`/api/tasks/${recent.taskId}`)
            .then((r) => r.json())
            .then((d) => {
              if (d.status === "completed" && d.results) {
                setActiveTask({
                  taskId: d.taskId,
                  status: "completed",
                  jobs: d.results.map((r: any, i: number) => ({
                    id: Date.now() + i,
                    status: r?.b64 ? "done" as const : "error" as const,
                    b64: r?.b64,
                    error: r?.error,
                    duration: r?.duration,
                  })),
                });
              }
            }).catch(() => {});
        }
      }).catch(() => {});
  }, []);

  const loadingMessages = [
    "先去刷一会B站吧～","泡杯咖啡等一下～","数到十就好了…大概吧",
    "AI 正在努力搓图ing","建议伸个懒腰再回来","去喝口水吧，快好了",
    "像素正在排队生成中","莫急，好图需要时间","这张图值得等待 ✨","AI 说它在认真画画",
  ];
  const [msg] = useState(() => loadingMessages[Math.floor(Math.random() * loadingMessages.length)]);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  // ── 耗时计时器 ──
  // 每秒 +1，仅在任务进行时运行
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!activeTask || activeTask.status === "completed" || activeTask.status === "failed") {
      setElapsed(0); return;
    }
    const id = setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [activeTask?.taskId, activeTask?.status]);

  // ── 文件工具函数 ──

  /** File 对象 → base64 字符串（去掉 data:image/...;base64, 前缀） */
  function readFileAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /** 批量添加参考图片（拖拽 / 文件选择） */
  async function addRefFiles(files: FileList | File[]) {
    const newB64s: string[] = [];
    for (const f of Array.from(files)) {
      if (!f.type.startsWith("image/")) continue;
      newB64s.push(await readFileAsBase64(f));
    }
    setRefImages((prev) => [...prev, ...newB64s]);
  }

  function removeRefImage(index: number) {
    setRefImages((prev) => prev.filter((_, i) => i !== index));
  }

  // ── 拖拽 ──

  function handleDrop(e: DragEvent) {
    e.preventDefault(); setDragOver(false);
    if (e.dataTransfer.files.length > 0) addRefFiles(e.dataTransfer.files);
  }
  function handleDragOver(e: DragEvent) { e.preventDefault(); setDragOver(true); }
  function handleDragLeave() { setDragOver(false); }

  // ── 图片操作按钮（复制 / 设为参考） ──

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

  function useAsRef(b64: string) {
    setRefImages((prev) => [...prev, b64]);
    setTimeout(() => refSectionRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  }

  /** 从 RecentResults 的图源引用：可能是 data URL 或 filePath */
  async function useAsRefFromRecent(src: string) {
    if (src.includes("base64,")) { useAsRef(src.split("base64,")[1]); return; }
    try {
      const res = await fetch(src);
      const blob = await res.blob();
      const reader = new FileReader();
      reader.onload = () => { useAsRef((reader.result as string).split(",")[1]); };
      reader.readAsDataURL(blob);
    } catch { /* ignore */ }
  }

  // ── 轮询 ──

  /**
   * 轮询任务状态
   *
   * while 循环每 2 秒请求一次 GET /api/tasks/:taskId。
   * 关键点：
   * - 用 currentTaskRef 控制退出条件（组件卸载 / 新任务覆盖时停止旧轮询）
   * - results 有值时立即渲染（增量展示，不等全部完成）
   * - completed → 停止轮询，结果区域滚动到底部
   * - failed → 更新状态，停止轮询
   */
  async function pollTask(taskId: string) {
    while (currentTaskRef.current === taskId) {
      const res = await fetch(`/api/tasks/${taskId}`);
      if (!res.ok) { await new Promise((r) => setTimeout(r, 2000)); continue; }
      const data = await res.json();

      // 有 results 时立即渲染（部分或全部）
      if (data.results && data.results.some((r: any) => r?.b64 || r?.error)) {
        setActiveTask({
          taskId,
          status: data.status,
          jobs: (data.results || []).map((r: any, i: number) => ({
            id: Date.now() + i,
            status: r?.b64 ? "done" as const : r?.error ? "error" as const : "loading" as const,
            b64: r?.b64,
            error: r?.error,
            duration: r?.duration,
            usage: r?.usage,
          })),
        });
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

  /**
   * 提交生成任务
   *
   * 流程：
   * 1. 立即显示 count 个 loading 卡片（优化体验：让用户知道"已经开始"）
   * 2. POST /api/tasks 创建任务，拿到 taskId
   * 3. 开始轮询 pollTask(taskId)
   *
   * 按钮防重复：activeTask 状态不是 completed/failed 时禁用提交。
   */
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || (activeTask && activeTask.status !== "completed" && activeTask.status !== "failed")) return;

    const placeholderJobs: JobItem[] = Array.from({ length: count }, (_, i) => ({
      id: Date.now() + i,
      status: "loading" as const,
    }));
    const tempId = `temp-${Date.now()}`;
    setActiveTask({ taskId: tempId, status: "pending", jobs: placeholderJobs });
    setPreviewIdx(null);

    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "generate",
          prompt: prompt.trim(),
          size,
          quality,
          count,
          refImages: refImages.length > 0 ? refImages : undefined,
        }),
      });
      const { taskId } = await res.json();

      currentTaskRef.current = taskId;
      setActiveTask((prev) => prev?.taskId === tempId ? { taskId, status: "pending", jobs: placeholderJobs } : prev);
      pollTask(taskId);
    } catch (err) {
      setActiveTask({
        taskId: "error",
        status: "failed",
        jobs: [{ id: Date.now(), status: "error", error: String(err) }],
      });
    }
  }

  const jobs = activeTask?.jobs || [];

  // ── 渲染 ──
  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="glass rounded-2xl p-6 space-y-4">
        {/* Prompt */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">描述词 (Prompt)</label>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)}
            placeholder="描述你想要生成的图片..." rows={3} autoComplete="off"
            className="w-full rounded-xl border border-slate-200 bg-white/60 px-4 py-3 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent resize-none transition-all" />
        </div>

        {/* Size / Quality / Count */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">尺寸 (Size)</label>
            <select value={size} onChange={(e) => setSize(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white/60 px-4 py-2.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent">
              {SIZES.map((s) => (<option key={s.value} value={s.value}>{s.label}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">质量 (Quality)</label>
            <select value={quality} onChange={(e) => setQuality(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white/60 px-4 py-2.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent">
              {QUALITIES.map((q) => (<option key={q.value} value={q.value}>{q.label}</option>))}
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

        {/* Reference images */}
        <div ref={refSectionRef}>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            参考图片 <span className="text-xs text-slate-400 font-normal">（可选，图生图）</span>
          </label>
          {refImages.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {refImages.map((b64, i) => (
                <div key={i} className="relative group">
                  <img src={dataUrlFromB64(b64)} alt={`参考图 ${i + 1}`}
                    className="w-20 h-20 object-cover rounded-xl border border-slate-200" />
                  <button type="button" onClick={() => removeRefImage(i)}
                    className="absolute -top-1.5 -right-1.5 bg-white rounded-full p-0.5 shadow border border-slate-200 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity" aria-label={`移除参考图 ${i + 1}`}>
                    <X size={12} className="text-slate-500" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div onClick={() => inputRef.current?.click()} onDrop={handleDrop}
            onDragOver={handleDragOver} onDragLeave={handleDragLeave}
            role="button" tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
            aria-label="点击或拖拽上传参考图片"
            className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all ${dragOver ? "border-indigo-400 bg-indigo-50" : "border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/30"}`}>
            <input ref={inputRef} type="file" accept="image/*" multiple className="hidden"
              onChange={(e) => { if (e.target.files && e.target.files.length > 0) addRefFiles(e.target.files); }} />
            <div className="flex items-center justify-center gap-2 text-slate-400">
              <Upload size={16} /><span className="text-sm">点击或拖拽上传参考图片（支持多图）</span>
            </div>
          </div>
        </div>

        {/* Submit + Clear */}
        <div className="flex gap-2">
          <button type="submit" disabled={(activeTask && activeTask.status !== "completed" && activeTask.status !== "failed") || !prompt.trim()}
            className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white rounded-xl py-3 text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed">
            <Sparkles size={16} />{activeTask && activeTask.status !== "completed" && activeTask.status !== "failed" ? "生成中..." : "生成图片"}
          </button>
          <button type="button" onClick={() => {
            setPrompt(""); setSize("auto"); setQuality("auto"); setCount(1); setRefImages([]);
            saveLS(LS_KEYS.prompt, ""); saveLS(LS_KEYS.size, "auto"); saveLS(LS_KEYS.quality, "auto"); saveLS(LS_KEYS.count, "1"); saveLSRefs([]);
          }}
            className="shrink-0 flex items-center gap-1.5 text-xs text-slate-500 hover:text-red-600 bg-white border border-slate-200 hover:border-red-300 rounded-xl px-4 py-3 transition-all"
            title="清除提示词和参考图片">
            <Trash2 size={14} />清除
          </button>
        </div>
      </form>

      {/* Result cards：每个 job 独立展示 */}
      {jobs.length > 0 && (
        <div ref={resultRef} className="space-y-3 animate-fade-in">
          <h2 className="text-sm font-medium text-slate-700">生成结果</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {jobs.map((job, i) => (
              <div key={job.id} className="glass rounded-2xl overflow-hidden">
                <div className="px-3 py-1.5 border-b border-white/20 flex items-center justify-between">
                  <span className="text-xs font-medium text-indigo-500"># {i + 1}</span>
                  {job.duration != null && <span className="text-[10px] text-slate-400">{job.duration}s</span>}
                </div>
                {/* loading 状态：旋转动画 + 耗时 */}
                {job.status === "loading" && (
                  <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-2">
                    <Loader2 size={20} className="animate-spin text-indigo-400" />
                    <span className="text-xs">{msg}</span>
                    {elapsed > 0 && <span className="text-[10px] text-slate-300">{elapsed}s</span>}
                  </div>
                )}
                {/* error 状态：显示错误信息 */}
                {job.status === "error" && (
                  <div className="flex flex-col items-center justify-center py-12 text-red-400 gap-1 px-4 text-center">
                    <p className="text-xs font-medium">失败</p>
                    <p className="text-[10px] text-red-300 break-all">{job.error}</p>
                  </div>
                )}
                {/* done 状态：显示图片 + hover 操作栏 */}
                {job.status === "done" && job.b64 && (
                  <div className="group relative">
                    <img src={dataUrlFromB64(job.b64)} alt={`结果 ${i + 1}`}
                      className="w-full h-auto object-cover cursor-pointer"
                      onClick={() => setPreviewIdx(i)} />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                      <button onClick={() => setPreviewIdx(i)}
                        className="bg-white/90 hover:bg-white text-slate-700 rounded-xl px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 shadow-lg"><Eye size={12} />预览</button>
                      <button onClick={() => saveToAlbum(dataUrlFromB64(job.b64!), `generated-${Date.now()}.png`)}
                        className="bg-white/90 hover:bg-white text-slate-700 rounded-xl px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 shadow-lg"><Download size={12} />{isMobile ? "保存到相册" : "下载"}</button>
                      <button onClick={() => handleCopy(job.b64!, i)}
                        className="bg-white/90 hover:bg-white text-slate-700 rounded-xl px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 shadow-lg">
                        {copiedIdx === i ? <Check size={12} /> : <Copy size={12} />}{copiedIdx === i ? "已复制" : "复制"}
                      </button>
                      <button onClick={() => useAsRef(job.b64!)}
                        className="bg-white/90 hover:bg-white text-indigo-600 rounded-xl px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 shadow-lg"><ImagePlus size={12} />作为参考</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <RecentResults type="generate" onUseAsRef={useAsRefFromRecent} />

      {/* 大图预览弹窗 */}
      {previewIdx !== null && jobs[previewIdx]?.b64 && (
        <ImagePreview
          src={dataUrlFromB64(jobs[previewIdx].b64!)}
          alt="生成结果预览"
          onClose={() => setPreviewIdx(null)}
          onDownload={() => saveToAlbum(dataUrlFromB64(jobs[previewIdx].b64!), `generated-${Date.now()}.png`)}
        />
      )}
    </div>
  );
}
