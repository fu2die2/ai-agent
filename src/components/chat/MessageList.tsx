/** 会話ログ。空のときは社内ナレッジ向けの例文を出す。本文は Markdown として描画する。 */
import { MarkdownBody } from "@/components/chat/MarkdownBody";
import type { ChatMessage } from "@/types/agent";

type Props = {
  messages: ChatMessage[];
  streaming?: boolean;
};

/** ユーザー右寄せ・エージェント左寄せで吹き出しを並べる。 */
export function MessageList({ messages, streaming }: Props) {
  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-8 text-center">
        <div>
          <p className="text-lg text-slate-800">何でも指示してください</p>
          <p className="mt-2 text-sm text-slate-500">
            例: 有給は何日？ Notionに議事メモのページを作って。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-4 overflow-y-auto px-6 py-6">
      {messages.map((message) => (
        <div
          key={message.id}
          className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
        >
          <div
            className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-6 ${
              message.role === "user"
                ? "bg-sky-500 text-white"
                : "border border-slate-200 bg-white text-slate-700"
            }`}
          >
            {message.role === "assistant" && (
              <p className="mb-1 text-[11px] tracking-wide text-slate-400 uppercase">
                Agent
              </p>
            )}
            <MarkdownBody
              content={message.content}
              tone={message.role === "user" ? "user" : "assistant"}
            />
          </div>
        </div>
      ))}
      {streaming && (
        <p className="text-sm text-slate-500">情報を検索して比較します。結果をまとめます…</p>
      )}
    </div>
  );
}
