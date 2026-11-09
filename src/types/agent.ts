import type { JsonValue, ToolExecution } from "./tool";

export type ChatRole = "user" | "assistant" | "system";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
};

export type TraceStepKind =
  | "planning"
  | "tool"
  | "verification"
  | "response";

export type TraceStepStatus = "running" | "completed" | "passed" | "failed";

export type TraceStep = {
  id: string;
  kind: TraceStepKind;
  title: string;
  detail?: string;
  status: TraceStepStatus;
  toolName?: string;
};

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

export type SessionRecord = SessionSummary & {
  messages: ChatMessage[];
  traces: TraceStep[];
  toolExecutions: ToolExecution[];
  lastAnswer?: string;
  verification?: VerificationResult;
};

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
