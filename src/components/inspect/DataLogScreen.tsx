/**
 * 処理の流れと、データがどこにどう入っているかを見る画面。
 * 会話を選ぶと、全発言の Gemini / Tool 入出力が見える。
 */
"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { MarkdownBody } from "@/components/chat/MarkdownBody";
import { JsonBlock } from "@/components/inspect/JsonBlock";
import type { IoChannel, IoRecord, RunIoLog, SessionRecord } from "@/types/agent";
import type { InspectSnapshot } from "@/types/inspect";

type Tab = "flow" | "session" | "chunks" | "memos";

/** タイムスタンプを画面用の時刻にする。 */
function formatTime(value: number | string) {
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("ja-JP");
}

/** データの置き場と、選んだ会話の中身をタブで切り替える。 */
export function DataLogScreen() {
  const [snapshot, setSnapshot] = useState<InspectSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("flow");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<SessionRecord | null>(null);

  /** /api/inspect から保存データの一覧を取る。 */
  const loadSnapshot = useCallback(async () => {
    setError(null);
    const response = await fetch("/api/inspect");
    if (!response.ok) {
      setError("スナップショットの取得に失敗しました");
      return;
    }
    const json = (await response.json()) as InspectSnapshot;
    setSnapshot(json);
    setSessionId((current) => current ?? json.stores.sessions.items[0]?.id ?? null);
  }, []);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  /** 選んだ会話の messages / eventLog / toolExecutions を取る。 */
  const loadSession = useCallback(async (id: string) => {
    const response = await fetch(`/api/sessions/${id}`);
    if (!response.ok) {
      setSession(null);
      return;
    }
    const json = (await response.json()) as { session: SessionRecord };
    setSession(json.session);
  }, []);

  useEffect(() => {
    if (!sessionId) {
      setSession(null);
      return;
    }
    void loadSession(sessionId);
  }, [sessionId, loadSession]);

  const tabs: { id: Tab; label: string }[] = [
    { id: "flow", label: "処理の流れ" },
    { id: "session", label: "会話データ" },
    { id: "chunks", label: "ナレッジチャンク" },
    { id: "memos", label: "メモ" },
  ];

  return (
    <div className="flex h-screen flex-col bg-[#f4f7fb] text-slate-800">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
        <div>
          <p className="text-sm text-slate-500">Data log</p>
          <h1 className="text-lg font-medium text-slate-900">処理の流れとデータの持ち方</h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void loadSnapshot()}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            再読み込み
          </button>
          <Link
            href="/"
            className="rounded-lg bg-sky-500 px-3 py-1.5 text-sm font-medium text-white"
          >
            チャットへ戻る
          </Link>
        </div>
      </header>

      <div className="flex gap-2 border-b border-slate-200 bg-white px-6 py-2">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              tab === item.id ? "bg-sky-100 text-sky-900" : "text-slate-500 hover:bg-slate-50"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-6 py-5">
        {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
        {!snapshot && !error && <p className="text-sm text-slate-500">読み込み中…</p>}
        {snapshot && tab === "flow" && <FlowPanel snapshot={snapshot} />}
        {snapshot && tab === "session" && (
          <SessionPanel
            snapshot={snapshot}
            sessionId={sessionId}
            session={session}
            onSelect={setSessionId}
          />
        )}
        {snapshot && tab === "chunks" && <ChunksPanel snapshot={snapshot} />}
        {snapshot && tab === "memos" && (
          <MemosPanel snapshot={snapshot} onChanged={() => void loadSnapshot()} />
        )}
      </div>
    </div>
  );
}

/** 固定のパイプラインと、環境・件数のサマリー。 */
function FlowPanel({ snapshot }: { snapshot: InspectSnapshot }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <SummaryCard
          title="Gemini"
          value={snapshot.env.gemini ? "キーあり" : "未設定"}
          hint="回答と埋め込み"
        />
        <SummaryCard
          title="Notion"
          value={snapshot.env.notion ? "接続あり" : "未設定"}
          hint="社内ナレッジの正本"
        />
        <SummaryCard
          title="PostgreSQL"
          value={snapshot.env.database ? "接続あり" : "未設定"}
          hint="チャンクとメモ"
        />
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <SummaryCard
          title="会話ファイル"
          value={`${snapshot.stores.sessions.count} 件`}
          hint={snapshot.stores.sessions.where}
        />
        <SummaryCard
          title="ナレッジチャンク"
          value={`${snapshot.stores.knowledgeChunks.count} 件`}
          hint={snapshot.stores.knowledgeChunks.where}
        />
        <SummaryCard
          title="メモ"
          value={`${snapshot.stores.memos.count} 件`}
          hint={snapshot.stores.memos.where}
        />
      </div>
      <ol className="space-y-2">
        {snapshot.flow.map((item) => (
          <li
            key={item.step}
            className="rounded-xl border border-slate-200 bg-white px-4 py-3"
          >
            <p className="text-sm font-medium text-slate-900">{item.step}</p>
            <p className="mt-1 text-sm text-slate-500">{item.detail}</p>
          </li>
        ))}
      </ol>
      <p className="text-[11px] text-slate-400">
        取得時刻 {formatTime(snapshot.generatedAt)}
        {snapshot.stores.knowledgeChunks.model
          ? ` / 埋め込みモデル ${snapshot.stores.knowledgeChunks.model}`
          : ""}
      </p>
    </div>
  );
}

/** 件数カード。 */
function SummaryCard({
  title,
  value,
  hint,
}: {
  title: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-[11px] text-slate-400">{title}</p>
      <p className="mt-1 text-lg text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  );
}

const CHANNEL_FILTERS: { id: "all" | IoChannel; label: string }[] = [
  { id: "all", label: "すべて" },
  { id: "user", label: "ユーザー" },
  { id: "gemini", label: "Gemini" },
  { id: "tool", label: "Tool" },
  { id: "verifier", label: "Verifier" },
  { id: "assistant", label: "最終回答" },
];

const CHANNEL_LABEL: Record<IoChannel, string> = {
  user: "ユーザー",
  gemini: "Gemini",
  tool: "Tool",
  verifier: "Verifier",
  assistant: "アシスタント",
};

/** 1会話の全発言の in/out を見る。 */
function SessionPanel({
  snapshot,
  sessionId,
  session,
  onSelect,
}: {
  snapshot: InspectSnapshot;
  sessionId: string | null;
  session: SessionRecord | null;
  onSelect: (id: string) => void;
}) {
  const [filter, setFilter] = useState<"all" | IoChannel>("all");

  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
      <div className="space-y-1">
        {snapshot.stores.sessions.items.length === 0 && (
          <p className="text-sm text-slate-500">まだ会話がありません</p>
        )}
        {snapshot.stores.sessions.items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
              sessionId === item.id ? "bg-sky-100 text-sky-900" : "bg-white text-slate-600"
            }`}
          >
            <span className="block truncate">{item.title}</span>
            <span className="mt-1 block text-[11px] text-slate-400">
              {formatTime(item.updatedAt)}
            </span>
          </button>
        ))}
      </div>
      <div className="min-w-0 space-y-4 overflow-x-auto">
        {!session && <p className="text-sm text-slate-500">会話を選ぶと中身が出ます</p>}
        {session && (
          <>
            <p className="text-xs text-slate-400">
              保存先 {snapshot.stores.sessions.where} / id {session.id}
            </p>
            <section>
              <h2 className="mb-2 text-sm font-medium text-slate-800">会話本文</h2>
              <div className="space-y-2">
                {session.messages.map((message) => (
                  <div
                    key={message.id}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-medium text-slate-700">
                        {message.role === "user" ? "ユーザー" : "アシスタント"}
                      </p>
                      <p className="text-[11px] text-slate-400">{formatTime(message.createdAt)}</p>
                    </div>
                    <div className="mt-1 min-w-0 overflow-x-auto text-sm text-slate-800">
                      <MarkdownBody content={message.content} tone={message.role === "user" ? "user" : "assistant"} />
                    </div>
                  </div>
                ))}
              </div>
            </section>
            <section>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-medium text-slate-800">全 in / out</h2>
                <div className="flex flex-wrap gap-1">
                  {CHANNEL_FILTERS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setFilter(item.id)}
                      className={`rounded-md px-2 py-1 text-[11px] ${
                        filter === item.id
                          ? "bg-sky-600 text-white"
                          : "bg-white text-slate-500 ring-1 ring-slate-200"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
              {(session.ioLogs ?? []).length === 0 ? (
                <LegacyIoPanel session={session} />
              ) : (
                <div className="space-y-3">
                  {(session.ioLogs ?? []).map((run, index) => (
                    <RunIoPanel
                      key={run.id}
                      run={run}
                      index={index}
                      total={(session.ioLogs ?? []).length}
                      filter={filter}
                      defaultOpen={index === (session.ioLogs ?? []).length - 1}
                    />
                  ))}
                </div>
              )}
            </section>
            {(session.eventLog ?? []).length > 0 && (
              <details className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                <summary className="cursor-pointer text-sm text-slate-700">
                  最後の実行の SSE イベント（{session.eventLog?.length ?? 0} 件）
                </summary>
                <div className="mt-2 space-y-2">
                  {(session.eventLog ?? []).map((event, index) => (
                    <div key={`${event.at}-${index}`}>
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-mono text-xs text-sky-800">{event.type}</p>
                        <p className="text-[11px] text-slate-400">{formatTime(event.at)}</p>
                      </div>
                      <JsonBlock value={event.data} label="data" />
                    </div>
                  ))}
                </div>
              </details>
            )}
            <JsonBlock
              value={{
                id: session.id,
                title: session.title,
                messages: session.messages,
                traces: session.traces,
                toolExecutions: session.toolExecutions,
                ioLogs: session.ioLogs,
                verification: session.verification,
                lastAnswer: session.lastAnswer,
              }}
              label="session（保存されている全文）"
            />
          </>
        )}
      </div>
    </div>
  );
}

/** ioLogs が無い古い会話向け。最後の実行の Tool だけ出す。 */
function LegacyIoPanel({ session }: { session: SessionRecord }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">
        この会話には全 in/out ログがありません。拡張後に送信した会話を選ぶと、Gemini の Tool 選択まで見られます。
      </p>
      {session.toolExecutions.length === 0 ? (
        <p className="text-sm text-slate-500">この実行では Tool は使っていません</p>
      ) : (
        session.toolExecutions.map((execution) => (
          <div key={execution.id} className="space-y-2">
            <p className="text-sm text-slate-700">
              {execution.name} / {execution.status}
            </p>
            <JsonBlock value={execution.arguments} label="IN arguments" />
            <JsonBlock
              value={execution.result ?? execution.error ?? null}
              label="OUT result"
            />
          </div>
        ))
      )}
    </div>
  );
}

/** ユーザー発言1回ぶんの入出力。 */
function RunIoPanel({
  run,
  index,
  total,
  filter,
  defaultOpen,
}: {
  run: RunIoLog;
  index: number;
  total: number;
  filter: "all" | IoChannel;
  defaultOpen: boolean;
}) {
  const items = run.exchanges.filter((item) => filter === "all" || item.channel === filter);
  return (
    <details
      open={defaultOpen}
      className="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2"
    >
      <summary className="cursor-pointer text-sm text-slate-800">
        実行 {index + 1}/{total}
        <span className="ml-2 text-xs font-normal text-slate-400">
          {formatTime(run.startedAt)}
          {run.endedAt ? ` → ${formatTime(run.endedAt)}` : ""}
          {` / ${run.exchanges.length} 件`}
        </span>
        <span className="mt-1 block truncate text-xs font-normal text-slate-500">
          {run.userMessage}
        </span>
      </summary>
      <div className="mt-3 space-y-2">
        {items.length === 0 && (
          <p className="text-sm text-slate-500">このフィルタに該当する入出力はありません</p>
        )}
        {items.map((item) => (
          <IoCard key={item.id} record={item} />
        ))}
      </div>
    </details>
  );
}

/** 1件の in または out。 */
function IoCard({ record }: { record: IoRecord }) {
  const inbound = record.direction === "in";
  return (
    <div
      className={`min-w-0 rounded-lg border px-3 py-2 ${
        inbound ? "border-sky-200 bg-sky-50/70" : "border-emerald-200 bg-emerald-50/70"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
              inbound ? "bg-sky-600 text-white" : "bg-emerald-600 text-white"
            }`}
          >
            {inbound ? "IN" : "OUT"}
          </span>
          <span className="text-[11px] text-slate-500">{CHANNEL_LABEL[record.channel]}</span>
          <span className="text-sm text-slate-800">{record.label}</span>
        </div>
        <p className="text-[11px] text-slate-400">{formatTime(record.at)}</p>
      </div>
      <div className="mt-2">
        <JsonBlock value={record.payload} label={inbound ? "IN" : "OUT"} />
      </div>
    </div>
  );
}

/** Postgres に入っているチャンク。ベクトルは先頭だけ。 */
function ChunksPanel({ snapshot }: { snapshot: InspectSnapshot }) {
  const store = snapshot.stores.knowledgeChunks;
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">
        {store.where} / {store.count} 件
        {store.model ? ` / ${store.model}` : ""}
        {store.corpusHash ? ` / hash ${store.corpusHash.slice(0, 12)}…` : ""}
      </p>
      {store.items.length === 0 && (
        <p className="text-sm text-slate-500">チャンクがありません。Notion 取得後にインデックスしてください。</p>
      )}
      {store.items.map((chunk) => (
        <details
          key={chunk.id}
          className="rounded-xl border border-slate-200 bg-white px-4 py-3"
        >
          <summary className="cursor-pointer text-sm text-slate-800">
            {chunk.title}
            <span className="ml-2 text-xs text-slate-400">
              {chunk.contentChars}文字 / ベクトル {chunk.embeddingDims}次元
            </span>
          </summary>
          <div className="mt-3 space-y-2">
            <p className="text-xs text-slate-500">
              {chunk.category || "（分類なし）"}
              {chunk.url?.startsWith("http") ? (
                <>
                  {" / "}
                  <a
                    href={chunk.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-sky-600 underline underline-offset-2"
                  >
                    Notionで開く
                  </a>
                </>
              ) : chunk.source ? (
                ` / ${chunk.source}`
              ) : null}
            </p>
            <p className="whitespace-pre-wrap text-sm text-slate-700">{chunk.content}</p>
            <JsonBlock
              value={{
                id: chunk.id,
                documentId: chunk.documentId,
                keywords: chunk.keywords,
                embeddingDims: chunk.embeddingDims,
                embeddingPreview: chunk.embeddingPreview,
                model: chunk.model,
              }}
              label="チャンクのメタデータ（ベクトルは先頭8件）"
            />
          </div>
        </details>
      ))}
    </div>
  );
}

/** Postgres の memos テーブル。本文は Markdown、削除は API 経由。 */
function MemosPanel({
  snapshot,
  onChanged,
}: {
  snapshot: InspectSnapshot;
  onChanged: () => void;
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const store = snapshot.stores.memos;

  /** 確認のうえ DELETE /api/memos/:id を呼び、一覧を取り直す。 */
  async function removeMemo(id: string, title: string) {
    if (!window.confirm(`「${title}」を削除しますか？`)) return;
    setPendingId(id);
    try {
      const response = await fetch(`/api/memos/${id}`, { method: "DELETE" });
      if (!response.ok) {
        window.alert("削除に失敗しました");
        return;
      }
      onChanged();
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">
        {store.where} / {store.count} 件
      </p>
      {store.items.length === 0 && <p className="text-sm text-slate-500">メモはまだありません</p>}
      {store.items.map((memo) => (
        <div key={memo.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-slate-800">{memo.title}</p>
              <p className="mt-1 text-xs text-slate-400">{formatTime(memo.createdAt)}</p>
            </div>
            <button
              type="button"
              disabled={pendingId === memo.id}
              onClick={() => void removeMemo(memo.id, memo.title)}
              className="shrink-0 rounded-lg border border-rose-200 px-2.5 py-1 text-xs text-rose-600 hover:bg-rose-50 disabled:opacity-40"
            >
              {pendingId === memo.id ? "削除中…" : "削除"}
            </button>
          </div>
          <div className="mt-3 text-sm text-slate-700">
            <MarkdownBody content={memo.content} tone="assistant" />
          </div>
        </div>
      ))}
    </div>
  );
}
