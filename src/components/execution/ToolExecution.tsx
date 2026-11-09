import type { TraceStep } from "@/types/agent";

const statusLabel: Record<TraceStep["status"], string> = {
  running: "実行中",
  completed: "完了",
  passed: "合格",
  failed: "失敗",
};

export function ToolExecution({ step }: { step: TraceStep }) {
  const tone =
    step.status === "failed"
      ? "text-rose-300"
      : step.status === "passed"
        ? "text-emerald-300"
        : step.status === "running"
          ? "text-amber-300"
          : "text-zinc-300";

  return (
    <div className="rounded-xl border border-white/8 bg-white/4 px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-zinc-100">{step.title}</p>
        <span className={`text-[11px] ${tone}`}>{statusLabel[step.status]}</span>
      </div>
      {step.detail && <p className="mt-1 text-xs text-zinc-500">{step.detail}</p>}
    </div>
  );
}
