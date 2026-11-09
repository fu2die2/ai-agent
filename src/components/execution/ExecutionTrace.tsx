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
    <aside className="flex h-full w-[320px] shrink-0 flex-col border-l border-slate-200 bg-white">
      <div className="flex items-center justify-between px-4 py-4">
        <p className="text-[11px] tracking-[0.18em] text-slate-400 uppercase">
          Execution Trace
        </p>
        <span className="text-[11px] text-slate-500">
          {running ? "Running" : "Completed"}
        </span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-3 pb-4">
        {steps.length === 0 ? (
          <p className="px-1 text-sm text-slate-400">
            送信すると、計画・Tool実行・検証がここに流れます。
          </p>
        ) : (
          steps.map((step) => <ToolExecution key={step.id} step={step} />)
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 border-t border-slate-200 p-4">
        <div className="rounded-xl bg-slate-50 px-3 py-3">
          <p className="text-[11px] text-slate-400">Tool calls</p>
          <p className="mt-1 text-lg text-slate-800">{summary?.toolCalls ?? 0}</p>
        </div>
        <div className="rounded-xl bg-slate-50 px-3 py-3">
          <p className="text-[11px] text-slate-400">Execution time</p>
          <p className="mt-1 text-lg text-slate-800">
            {summary ? `${(summary.durationMs / 1000).toFixed(1)}s` : "—"}
          </p>
        </div>
        {verification && (
          <div className="col-span-2 rounded-xl bg-slate-50 px-3 py-3">
            <p className="text-[11px] text-slate-400">Verifier</p>
            <p className="mt-1 text-sm text-slate-700">{verification.summary}</p>
          </div>
        )}
      </div>
    </aside>
  );
}
