/**
 * Next.js 設定。
 * CSS は Tailwind v4 の Turbopack ローダー経由。
 * root を明示して、親ディレクトリに別の lockfile があるときの取り違えを防ぐ。
 */
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
