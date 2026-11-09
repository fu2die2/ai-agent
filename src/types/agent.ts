/**
 * エージェント実行まわりの型。
 *
 * 画面（チャット・Execution Trace）と API（SSE イベント）が同じ形を共有する。
 * 会話セッションは .data/sessions.json、メモは PostgreSQL に保存する。
 */
import type { JsonValue, ToolExecution } from "./tool";

export type ChatRole = "user" | "assistant" | "system";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
};

/** Execution Trace の1ステップ。計画 → Tool → 検証 → 最終回答の順で増える。 */
export type TraceStepKind = "planning" | "tool" | "verification" | "response";

export type TraceStepStatus = "running" | "completed" | "passed" | "failed";

export type TraceStep = {
  id: string;
  kind: TraceStepKind;
  title: string;
  detail?: string;
  status: TraceStepStatus;
  toolName?: string;
};

/** Verifier の判定結果。failed のときは Orchestrator が回答を書き直すことがある。 */
export type VerificationResult = {
  status: "passed" | "failed";
  issues: string[];
  summary: string;
};

export type AgentRunSummary = {
  toolCalls: number;
  durationMs: number;
};

export type SessionSummary = {
  id: string;
  title: string;
  updatedAt: number;
};

/** 1会話の全文。履歴クリックでこのレコードを読み戻す。 */
export type SessionRecord = SessionSummary & {
  messages: ChatMessage[];
  traces: TraceStep[];
  toolExecutions: ToolExecution[];
  lastAnswer?: string;
  verification?: VerificationResult;
};

/**
 * /api/agent/stream が送る SSE イベント。
 * クライアント（AgentStudio）は event 名で UI を更新する。
 */
export type AgentEvent =
  | { type: "agent.started"; data: { status: "running"; sessionId: string } }
  | { type: "agent.planning"; data: { status: TraceStepStatus; detail: string } }
  | {
      type: "tool.started";
      data: { id: string; name: string; arguments?: Record<string, JsonValue> };
    }
  | {
      type: "tool.completed";
      data: {
        id: string;
        name: string;
        status: "success" | "error";
        result?: JsonValue;
        error?: string;
      };
    }
  | { type: "verification.started"; data: { status: "running" } }
  | {
      type: "verification.completed";
      data: VerificationResult;
    }
  | {
      type: "agent.delta";
      data: { content: string };
    }
  | {
      type: "agent.completed";
      data: {
        status: "completed";
        answer: string;
        verification: VerificationResult;
        summary: AgentRunSummary;
      };
    }
  | { type: "agent.error"; data: { message: string } };

export type Memo = {
  id: string;
  title: string;
  content: string;
  createdAt: number;
};
