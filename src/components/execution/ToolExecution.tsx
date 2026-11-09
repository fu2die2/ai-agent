/** Execution Trace の1行。status で色を変える（実行中=琥珀、合格=緑、失敗=赤）。 */
import type { TraceStep } from "@/types/agent";

const statusLabel: Record<TraceStep["status"], string> = {
  running: "実行中",
  completed: "完了",
  passed: "合格",
  failed: "失敗",
};

/** Trace の1ステップをカード表示する。 */
export function ToolExecution({ step }: { step: TraceStep }) {
  const tone =
    step.status === "failed"
      ? "text-rose-600"
      : step.status === "passed"
        ? "text-emerald-600"
        : step.status === "running"
          ? "text-amber-600"
          : "text-slate-500";

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-800">{step.title}</p>
        <span className={`text-[11px] ${tone}`}>{statusLabel[step.status]}</span>
      </div>
      {step.detail && <p className="mt-1 text-xs text-slate-500">{step.detail}</p>}
    </div>
  );
}
