import type { ChatMessage } from "@/types/agent";

type Props = {
  messages: ChatMessage[];
  streaming?: boolean;
};

export function MessageList({ messages, streaming }: Props) {
  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-8 text-center">
        <div>
          <p className="text-lg text-zinc-200">何でも指示してください</p>
          <p className="mt-2 text-sm text-zinc-500">
            例: 東京と大阪の人口を調べて、比較して。結果をメモに保存して。
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
            className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-6 whitespace-pre-wrap ${
              message.role === "user"
                ? "bg-cyan-400/15 text-cyan-50"
                : "bg-white/6 text-zinc-200"
            }`}
          >
            {message.role === "assistant" && (
              <p className="mb-1 text-[11px] tracking-wide text-zinc-500 uppercase">
                Agent
              </p>
            )}
            {message.content}
          </div>
        </div>
      ))}
      {streaming && (
        <p className="text-sm text-zinc-500">情報を検索して比較します。結果をまとめます…</p>
      )}
    </div>
  );
}
