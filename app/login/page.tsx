"use client";

import { useState, type FormEvent, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Wand2, Loader2 } from "lucide-react";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "登录失败");
        return;
      }

      const redirect = searchParams.get("redirect") || "/";
      router.push(redirect);
    } catch {
      setError("网络错误");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-indigo-50 p-4">
      <div className="w-full max-w-sm">
        <div className="glass rounded-2xl p-8 shadow-xl">
          {/* Logo */}
          <div className="flex items-center justify-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-400 to-purple-400 flex items-center justify-center shadow-lg">
              <Wand2 size={22} className="text-white" />
            </div>
            <h1 className="text-xl font-semibold text-slate-800">AI Image Studio</h1>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">用户名</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="请输入用户名"
                autoFocus
                className="w-full rounded-xl border border-slate-200 bg-white/60 px-4 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-300 transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">密码</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入密码"
                className="w-full rounded-xl border border-slate-200 bg-white/60 px-4 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-300 transition-all"
              />
            </div>

            {error && (
              <p className="text-sm text-red-500 bg-red-50 rounded-lg px-4 py-2">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !username.trim() || !password}
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white rounded-xl py-2.5 text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-indigo-200"
            >
              {loading ? (
                <><Loader2 size={16} className="animate-spin" />登录中...</>
              ) : (
                "登录"
              )}
            </button>
          </form>
        </div>
        <p className="text-center text-xs text-slate-400 mt-4">登录后 30 天内免登录</p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-indigo-50">
        <Loader2 size={24} className="animate-spin text-indigo-400" />
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
