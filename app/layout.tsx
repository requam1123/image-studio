import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Image Studio",
  description: "AI 图片生成与编辑工具",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
