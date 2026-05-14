/**
 * 通用按钮组件
 *
 * 4 种变体（variant）：
 * - ghost   → 默认样式，带边框 + hover 变色（用于一般操作按钮）
 * - icon    → 仅图标按钮，无边框，hover 出边框（用于关闭/设置等图标按钮）
 * - text    → 文字按钮，带边框（用于取消等次要操作）
 * - danger  → 危险操作，hover 变红色（用于删除）
 *
 * 透传所有 ButtonHTMLAttributes（onClick、disabled、className 等）。
 * icon 和 children 可选，支持纯图标或图标+文字组合。
 */

import type { ReactNode, ButtonHTMLAttributes } from "react";

type Variant = "ghost" | "icon" | "text" | "danger";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: ReactNode;
  children?: ReactNode;
}

const variantStyles: Record<Variant, string> = {
  ghost:
    "flex items-center gap-1.5 text-xs text-slate-600 hover:text-indigo-600 bg-white hover:bg-indigo-50 border border-slate-200 hover:border-indigo-300 rounded-lg px-3 py-1.5 transition-all",
  icon: "text-slate-400 hover:text-slate-600 border border-transparent hover:border-slate-200 rounded-lg p-1.5 transition-all",
  text: "text-xs text-slate-500 hover:text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 transition-all flex items-center gap-1",
  danger:
    "text-xs text-slate-500 hover:text-red-600 bg-white hover:bg-red-50 border border-slate-200 hover:border-red-300 rounded-lg px-3 py-1.5 transition-all flex items-center gap-1",
};

export default function Button({ variant = "ghost", icon, children, className = "", ...rest }: Props) {
  return (
    <button className={`${variantStyles[variant]} ${className}`} {...rest}>
      {icon && <span className="shrink-0">{icon}</span>}
      {children}
    </button>
  );
}
