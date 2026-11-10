/**
 * データの実体を人が読める JSON として出す。コピーボタン付き。
 */
"use client";

import { useState } from "react";

/** value を整形して pre に出す。 */
export function JsonBlock({ value, label }: { value: unknown; label?: string }) {
  const [copied, setCopied] = useState(false);
  const text = JSON.stringify(value, null, 2);

  /** クリップボードへコピーし、短く「コピーした」と出す。 */
  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-950">
      <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
        <p className="text-[11px] tracking-wide text-slate-400 uppercase">
          {label ?? "JSON"}
        </p>
        <button
          type="button"
          onClick={() => void copy()}
          className="text-[11px] text-sky-300 hover:text-sky-200"
        >
          {copied ? "コピーしました" : "コピー"}
        </button>
      </div>
      <pre className="max-h-[28rem] overflow-auto p-3 text-[11px] leading-5 text-slate-100">
        {text}
      </pre>
    </div>
  );
}
