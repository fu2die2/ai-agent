/**
 * 全ページ共通レイアウト。
 * 明るい背景と日本語 lang。フォントは Geist（本文）と Geist Mono（コード向け変数）。
 */
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Agent Studio",
  description: "Tool Calling と Verifier を備えた AI エージェント",
};

/** html/body とフォント変数を付ける。 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-[#f4f7fb] font-sans text-slate-800">
        {children}
      </body>
    </html>
  );
}
