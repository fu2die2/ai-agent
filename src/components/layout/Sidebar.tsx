/** 左の会話履歴。New Agent は画面上のメッセージを空にする（サーバー側セッションは残る）。 */
import type { SessionSummary } from "@/types/agent";

type Props = {
  sessions: SessionSummary[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
};

/** 左カラム。新規会話ボタンと保存済みセッション一覧。 */
export function Sidebar({ sessions, currentId, onSelect, onNew }: Props) {
  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="flex items-center justify-between px-4 py-4">
        <div>
          <p className="text-[11px] tracking-[0.22em] text-slate-400 uppercase">
            Agent Studio
          </p>
          <p className="mt-1 font-medium text-slate-900">AI Ajent</p>
        </div>
        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700">
          Online
        </span>
      </div>
      <div className="px-3">
        <button
          type="button"
          onClick={onNew}
          className="w-full rounded-lg bg-sky-50 px-3 py-2 text-left text-sm text-sky-800 transition hover:bg-sky-100"
        >
          + New Agent
        </button>
      </div>
      <p className="mt-6 px-4 text-[11px] tracking-[0.18em] text-slate-400 uppercase">
        History
      </p>
      <div className="mt-2 flex-1 space-y-1 overflow-y-auto px-2 pb-4">
        {sessions.length === 0 ? (
          <p className="px-2 text-sm text-slate-400">まだ会話はありません</p>
        ) : (
          sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              onClick={() => onSelect(session.id)}
              className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                currentId === session.id
                  ? "bg-sky-100 text-sky-900"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              {session.title}
            </button>
          ))
        )}
      </div>
    </aside>
  );
}
