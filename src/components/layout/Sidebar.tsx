import type { SessionSummary } from "@/types/agent";

type Props = {
  sessions: SessionSummary[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
};

export function Sidebar({ sessions, currentId, onSelect, onNew }: Props) {
  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col border-r border-white/8 bg-[#101218]">
      <div className="flex items-center justify-between px-4 py-4">
        <div>
          <p className="text-[11px] tracking-[0.22em] text-zinc-500 uppercase">
            Agent Studio
          </p>
          <p className="mt-1 font-medium text-zinc-100">AI Ajent</p>
        </div>
        <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-300">
          Online
        </span>
      </div>
      <div className="px-3">
        <button
          type="button"
          onClick={onNew}
          className="w-full rounded-lg bg-white/8 px-3 py-2 text-left text-sm text-zinc-100 transition hover:bg-white/12"
        >
          + New Agent
        </button>
      </div>
      <p className="mt-6 px-4 text-[11px] tracking-[0.18em] text-zinc-500 uppercase">
        History
      </p>
      <div className="mt-2 flex-1 space-y-1 overflow-y-auto px-2 pb-4">
        {sessions.length === 0 ? (
          <p className="px-2 text-sm text-zinc-500">まだ会話はありません</p>
        ) : (
          sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              onClick={() => onSelect(session.id)}
              className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                currentId === session.id
                  ? "bg-cyan-400/12 text-cyan-100"
                  : "text-zinc-300 hover:bg-white/6"
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
