"use client";

/**
 * 主页面
 *
 * 整体布局：
 * - Header：Logo + 历史记录按钮 + 退出登录 + 齿轮设置
 * - Tab 切换：图片生成 / 图片编辑
 * - Main 区域：根据当前 Tab 显示 ImageGenerator 或 ImageEditor
 * - Footer：底部版权
 *
 * Tab 切换策略（重要）：
 *   使用 CSS hidden 类控制显示/隐藏，而非条件挂载。
 *   两个组件始终在 DOM 中，切换 Tab 时不丢失状态（轮询继续、输入内容保留）。
 *
 * 弹窗管理：
 * - apiSettings 同时被两种方式触发：
 *   1. Header 中的齿轮按钮 → 通过 onOpen 控制 showSettings
 *   2. ApiSettings 组件自身的内部状态（props.open 为 undefined 时）
 *   本例中 Header 按钮设 onOpen，弹窗由 showSettings 控制模式打开。
 * - HistoryPanel 通过右侧滑出面板展示，由 showHistory 控制。
 */

import { useState } from "react";
import { Image, Wand2, Clock, LogOut } from "lucide-react";
import ImageGenerator from "@/components/ImageGenerator";
import ImageEditor from "@/components/ImageEditor";
import HistoryPanel from "@/components/HistoryPanel";
import ApiSettings from "@/components/ApiSettings";
import Button from "@/components/ui/Button";

type Tab = "generate" | "edit";

export default function Home() {
  const [tab, setTab] = useState<Tab>("generate");
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  return (
    <div className="min-h-screen flex flex-col">
      {/* ===== Header ===== */}
      <header className="glass border-b border-white/20">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          {/* 左侧：Logo + 标题 */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-400 to-purple-400 flex items-center justify-center">
              <Wand2 size={18} className="text-white" />
            </div>
            <h1 className="text-lg font-semibold text-slate-800">
              AI Image Studio
            </h1>
          </div>
          {/* 右侧：历史记录 → 退出登录 → 齿轮设置 */}
          <div className="flex items-center gap-2">
            <Button icon={<Clock size={14} />} onClick={() => setShowHistory(true)}>
              历史记录
            </Button>
            <Button
              icon={<LogOut size={14} />}
              onClick={async () => {
                await fetch("/api/auth/logout", { method: "POST" });
                window.location.href = "/login";
              }}
              className="hover:text-red-500"
              title="退出登录"
            >
              退出
            </Button>
            {/* 齿轮按钮：通过 onOpen 让外层控制弹窗，兼容受控模式 */}
            <ApiSettings onOpen={() => setShowSettings(true)} />
          </div>
        </div>
      </header>

      {/* ===== Tab 切换栏 ===== */}
      <div className="max-w-5xl mx-auto px-4 pt-6 pb-2 w-full">
        <div className="glass rounded-xl p-1 inline-flex gap-1">
          <button
            onClick={() => setTab("generate")}
            className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === "generate"
                ? "bg-white text-indigo-600 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            <Image size={16} />
            图片生成
          </button>
          <button
            onClick={() => setTab("edit")}
            className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === "edit"
                ? "bg-white text-indigo-600 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            <Wand2 size={16} />
            图片编辑
          </button>
        </div>
      </div>

      {/* ===== 主内容区 ===== */}
      <main className="max-w-5xl mx-auto px-4 py-4 w-full flex-1">
        {/*
          同时渲染两个组件，用 CSS hidden 切换。
          这样切 Tab 不 unmount 组件，轮询 / elaped timer / localStorage 状态都在。
        */}
        <div className={tab === "generate" ? "" : "hidden"}><ImageGenerator /></div>
        <div className={tab === "edit" ? "" : "hidden"}><ImageEditor /></div>
      </main>

      {/* ===== 弹窗 ===== */}
      {/* API 设置弹窗（受控模式：由 showSettings 控制打开/关闭） */}
      {showSettings && (
        <ApiSettings
          open={showSettings}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* 历史记录侧面板 */}
      <HistoryPanel open={showHistory} onClose={() => setShowHistory(false)} />

      {/* ===== Footer ===== */}
      <footer className="text-center py-4 text-xs text-slate-400">
        Powered by gpt-image-2
      </footer>
    </div>
  );
}
