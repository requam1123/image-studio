"use client";

/**
 * API 设置弹窗
 *
 * 齿轮按钮点击后弹出的配置面板，功能：
 * 1. 显示当前轮转密钥列表（从服务端读取，只读展示）
 * 2. 编辑 API 地址（baseUrl）、模型（model）
 * 3. 保存当前配置到用户配置（PATCH /api/users）
 * 4. 预设管理：将当前配置保存为预设、加载预设、删除预设
 *
 * 弹窗有两种控制模式（受控模式）：
 * - 受控（controlledOpen 传入）：由父组件通过 open/onClose 控制
 * - 非受控（controlledOpen 未传入）：组件内部管理 open/close 状态
 *
 * 页面 Header 中的齿轮一直使用非受控模式（只传 onOpen），
 * 页面顶层的 ApiSettings 弹窗使用受控模式（open + onClose）。
 */

import { useState, useEffect } from "react";
import { Settings, X, Check, Loader2, Trash2, Plus, ArrowRight } from "lucide-react";

/** 预设数据结构 */
interface Preset { id: string; name: string; apiKey: string; apiBaseUrl: string | null; }

interface Props {
  open?: boolean;
  onClose?: () => void;
  onOpen?: () => void;
}

export default function ApiSettings({ open: controlledOpen, onClose, onOpen }: Props) {
  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? controlledOpen : internalOpen;

  const [apiKey, setApiKey] = useState("");
  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [presetName, setPresetName] = useState("");
  const [tokens, setTokens] = useState<string[]>([]);
  const [model, setModel] = useState("");

  function doOpen() {
    if (onOpen) { onOpen(); return; }
    if (!isControlled) setInternalOpen(true);
  }

  function doClose() {
    if (onClose) onClose();
    if (!isControlled) setInternalOpen(false);
  }

  /** 加载预设列表 */
  function loadPresets() {
    fetch("/api/users/presets").then(async (res) => {
      if (!res.ok) return;
      const data = await res.json();
      setPresets(data.presets || []);
    });
  }

  /** 弹窗打开时加载用户配置和预设 */
  useEffect(() => {
    if (!open) return;
    loadPresets();
    fetch("/api/users").then(async (res) => {
      if (!res.ok) return;
      const data = await res.json();
      setApiKey(data.apiKey || "");
      setApiBaseUrl(data.apiBaseUrl || "");
      setModel(data.model || "");
      if (data.tokens) setTokens(data.tokens);
    });
  }, [open]);

  /** 保存当前配置到服务端 */
  async function handleSave() {
    setSaving(true);
    try {
      await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: apiKey || undefined,
          apiBaseUrl: apiBaseUrl || undefined,
          model: model || undefined,
        }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      loadPresets();
    } catch { /* ignore */ }
    setSaving(false);
  }

  /** 将当前配置保存为预设 */
  async function saveAsPreset() {
    const name = presetName.trim() || `配置 ${presets.length + 1}`;
    try {
      await fetch("/api/users/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, apiKey, apiBaseUrl: apiBaseUrl || undefined, model: model || undefined }),
      });
      setPresetName("");
      loadPresets();
    } catch { /* ignore */ }
  }

  /** 删除预设 */
  async function deletePreset(id: string) {
    try {
      await fetch(`/api/users/presets?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      loadPresets();
    } catch { /* ignore */ }
  }

  /** 加载预设到当前表单并自动保存 */
  function applyPreset(p: Preset) {
    setApiKey(p.apiKey || "");
    setApiBaseUrl(p.apiBaseUrl || "");
    setModel((p as any).model || "");
    fetch("/api/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: p.apiKey || undefined, apiBaseUrl: p.apiBaseUrl || undefined, model: (p as any).model || undefined }),
    }).then(() => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  }

  return (
    <>
      {/* 齿轮按钮（始终显示在 Header） */}
      <button
        onClick={doOpen}
        className="text-slate-400 hover:text-slate-600 transition-colors"
        title="API 设置"
      >
        <Settings size={16} />
      </button>

      {/* 弹窗 */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/30 backdrop-blur-sm"
          onClick={doClose}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 mt-10 mb-4 sm:my-auto overflow-y-auto max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 弹窗头部：标题 + 关闭按钮（sticky 定位，滚动时保持在顶部） */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 sticky top-0 bg-white z-10">
              <h2 className="text-sm font-semibold text-slate-700">API 配置</h2>
              <button onClick={doClose} className="text-slate-400 hover:text-slate-600">
                <X size={16} />
              </button>
            </div>

            {/* 弹窗内容 */}
            <div className="p-5 space-y-4">
              {/* 轮转密钥展示（只读，从服务端读取） */}
              {tokens.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">轮转密钥（{tokens.length} 个）</label>
                  <div className="space-y-1 bg-slate-50 rounded-xl px-3 py-2.5">
                    {tokens.map((t: string, i: number) => (
                      <div key={i} className="text-[11px] text-slate-600 font-mono truncate">#{i + 1}: {t}</div>
                    ))}
                  </div>
                </div>
              )}

              {/* API 地址输入 */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">API 地址 <span className="text-slate-400 font-normal">（可选）</span></label>
                <input
                  type="text"
                  value={apiBaseUrl}
                  onChange={(e) => setApiBaseUrl(e.target.value)}
                  placeholder="https://api.bltcy.ai"
                  className="w-full rounded-xl border border-slate-200 bg-white/60 px-4 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
              </div>

              {/* 模型输入 */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">模型 <span className="text-slate-400 font-normal">（可选，留空则用前端默认值）</span></label>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="gpt-image-2"
                  className="w-full rounded-xl border border-slate-200 bg-white/60 px-4 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
              </div>

              {/* 保存按钮 */}
              <button
                onClick={handleSave}
                disabled={saving || (!apiKey && !apiBaseUrl && !model)}
                className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white rounded-xl py-2.5 text-sm font-medium transition-all disabled:opacity-50"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : null}
                {saved ? "已保存" : saving ? "保存中..." : "保存"}
              </button>

              <hr className="border-slate-100" />

              {/* 保存为预设 */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">保存为预设</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={presetName}
                    onChange={(e) => setPresetName(e.target.value)}
                    placeholder="名称（如：中转站A）"
                    className="flex-1 min-w-0 rounded-xl border border-slate-200 bg-white/60 px-4 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  />
                  <button
                    onClick={saveAsPreset}
                    disabled={!apiKey && !apiBaseUrl}
                    className="shrink-0 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-xl px-3 py-2 text-sm font-medium transition-all disabled:opacity-50 flex items-center gap-1"
                  >
                    <Plus size={14} />
                    保存
                  </button>
                </div>
              </div>

              {/* 已保存的预设列表 */}
              {presets.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-2">已保存的配置</label>
                  <div className="space-y-2">
                    {presets.map((p) => (
                      <div key={p.id} className="flex items-center justify-between bg-slate-50 rounded-xl px-3 sm:px-4 py-2.5 gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-slate-700 truncate">{p.name}</p>
                          <p className="text-[11px] text-slate-400 truncate">{(p as any).model ? `${(p as any).model} · ` : ""}{p.apiKey ? p.apiKey.slice(0,12) + "..." : ""}{p.apiBaseUrl ? ` · ${p.apiBaseUrl}` : ""}</p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {/* 应用预设 → 直接覆盖当前表单并保存 */}
                          <button onClick={() => applyPreset(p)} className="text-indigo-500 hover:text-indigo-700 p-1.5 rounded-lg hover:bg-indigo-50 transition-all" title="切换到此配置">
                            <ArrowRight size={14} />
                          </button>
                          {/* 删除预设 */}
                          <button onClick={() => deletePreset(p.id)} className="text-slate-400 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50 transition-all" title="删除">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
