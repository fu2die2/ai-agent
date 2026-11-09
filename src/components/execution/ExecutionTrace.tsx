import { ToolExecution } from "./ToolExecution";
import type { AgentRunSummary, TraceStep, VerificationResult } from "@/types/agent";

type Props = {
  steps: TraceStep[];
  summary?: AgentRunSummary | null;
  verification?: VerificationResult | null;
  running?: boolean;
};

export function ExecutionTrace({ steps, summary, verification, running }: Props) {
  return (
    <aside className="flex h-full w-[320px] shrink-0 flex-col border-l border-white/8 bg-[#101218]">
      <div className="flex items-center justify-between px-4 py-4">
        <p className="text-[11px] tracking-[0.18em] text-zinc-500 uppercase">
          Execution Trace
        </p>
        <span className="text-[11px] text-zinc-400">
          {running ? "Running" : "Completed"}
        </span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-3 pb-4">
        {steps.length === 0 ? (
          <p className="px-1 text-sm text-zinc-500">
            送信すると、計画・Tool実行・検証がここに流れます。
          </p>
        ) : (
          steps.map((step) => <ToolExecution key={step.id} step={step} />)
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 border-t border-white/8 p-4">
        <div className="rounded-xl bg-white/4 px-3 py-3">
          <p className="text-[11px] text-zinc-500">Tool calls</p>
          <p className="mt-1 text-lg text-zinc-100">{summary?.toolCalls ?? 0}</p>
        </div>
        <div className="rounded-xl bg-white/4 px-3 py-3">
          <p className="text-[11px] text-zinc-500">Execution time</p>
          <p className="mt-1 text-lg text-zinc-100">
            {summary ? `${(summary.durationMs / 1000).toFixed(1)}s` : "—"}
          </p>
        </div>
        {verification && (
          <div className="col-span-2 rounded-xl bg-white/4 px-3 py-3">
            <p className="text-[11px] text-zinc-500">Verifier</p>
            <p className="mt-1 text-sm text-zinc-100">{verification.summary}</p>
          </div>
        )}
      </div>
    </aside>
  );
}
