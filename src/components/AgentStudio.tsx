"use client";

import { useCallback, useEffect, useState } from "react";
import { ChatInput } from "@/components/chat/ChatInput";
import { MessageList } from "@/components/chat/MessageList";
import { ExecutionTrace } from "@/components/execution/ExecutionTrace";
import { Sidebar } from "@/components/layout/Sidebar";
import type {
  AgentRunSummary,
  ChatMessage,
  SessionSummary,
  TraceStep,
  VerificationResult,
} from "@/types/agent";

function createId() {
  return `session_${Date.now()}`;
}

function parseSseChunk(buffer: string) {
  const events: { event: string; data: string }[] = [];
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  for (const part of parts) {
    let event = "message";
    let data = "";
    for (const line of part.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (data) events.push({ event, data });
  }
  return { events, rest };
}

export function AgentStudio() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [steps, setSteps] = useState<TraceStep[]>([]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<AgentRunSummary | null>(null);
  const [verification, setVerification] = useState<VerificationResult | null>(null);

  const refreshSessions = useCallback(async () => {
    const response = await fetch("/api/sessions");
    const json = (await response.json()) as { sessions: SessionSummary[] };
    setSessions(json.sessions);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshSessions();
  }, [refreshSessions]);

  const loadSession = async (id: string) => {
    const response = await fetch(`/api/sessions/${id}`);
    if (!response.ok) return;
    const json = (await response.json()) as {
      session: {
        messages: ChatMessage[];
        traces: TraceStep[];
        verification?: VerificationResult;
      };
    };
    setSessionId(id);
    setMessages(json.session.messages);
    setSteps(json.session.traces);
    setVerification(json.session.verification ?? null);
  };

  const startNew = () => {
    setSessionId(null);
    setMessages([]);
    setSteps([]);
    setSummary(null);
    setVerification(null);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || running) return;
    const currentId = sessionId ?? createId();
    setSessionId(currentId);
    setInput("");
    setRunning(true);
    setSummary(null);
    setVerification(null);
    setSteps([
      {
        id: "planning",
        kind: "planning",
        title: "Agent Planning",
        detail: "依頼を分析しています",
        status: "running",
      },
    ]);
    setMessages((current) => [
      ...current,
      {
        id: `local_${Date.now()}`,
        role: "user",
        content: text,
        createdAt: Date.now(),
      },
    ]);

    const response = await fetch("/api/agent/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: currentId, message: text }),
    });

    if (!response.body) {
      setRunning(false);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let assistant = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseSseChunk(buffer);
      buffer = parsed.rest;

      for (const item of parsed.events) {
        const data = JSON.parse(item.data) as Record<string, unknown>;
        if (item.event === "agent.planning") {
          setSteps((current) =>
            current.map((step) =>
              step.kind === "planning"
                ? {
                    ...step,
                    status: data.status === "completed" ? "completed" : "running",
                    detail: String(data.detail ?? step.detail),
                  }
                : step,
            ),
          );
        }
        if (item.event === "tool.started") {
          setSteps((current) => [
            ...current,
            {
              id: String(data.id),
              kind: "tool",
              title: String(data.name),
              toolName: String(data.name),
              status: "running",
              detail: "実行中",
            },
          ]);
        }
        if (item.event === "tool.completed") {
          setSteps((current) =>
            current.map((step) =>
              step.id === data.id
                ? {
                    ...step,
                    status: data.status === "error" ? "failed" : "completed",
                    detail: data.status === "error" ? String(data.error) : "Success",
                  }
                : step,
            ),
          );
        }
        if (item.event === "verification.started") {
          setSteps((current) => [
            ...current,
            {
              id: "verifier",
              kind: "verification",
              title: "Result Verifier",
              status: "running",
              detail: "結果を検証しています",
            },
          ]);
        }
        if (item.event === "verification.completed") {
          const result = data as unknown as VerificationResult;
          setVerification(result);
          setSteps((current) =>
            current.map((step) =>
              step.id === "verifier"
                ? {
                    ...step,
                    status: result.status === "passed" ? "passed" : "failed",
                    detail: result.summary,
                  }
                : step,
            ),
          );
        }
        if (item.event === "agent.delta") {
          assistant = String(data.content ?? "");
        }
        if (item.event === "agent.completed") {
          const payload = data as unknown as {
            answer: string;
            summary: AgentRunSummary;
            verification: VerificationResult;
          };
          assistant = payload.answer;
          setSummary(payload.summary);
          setVerification(payload.verification);
          setMessages((current) => [
            ...current,
            {
              id: `assistant_${Date.now()}`,
              role: "assistant",
              content: payload.answer,
              createdAt: Date.now(),
            },
          ]);
        }
        if (item.event === "agent.error") {
          setMessages((current) => [
            ...current,
            {
              id: `error_${Date.now()}`,
              role: "assistant",
              content: `エラー: ${String(data.message)}`,
              createdAt: Date.now(),
            },
          ]);
        }
      }
    }

    if (assistant) {
      setSteps((current) =>
        current.some((step) => step.kind === "response")
          ? current
          : [
              ...current,
              {
                id: "final",
                kind: "response",
                title: "Final Response",
                status: "completed",
                detail: "分析結果をユーザーに返却",
              },
            ],
      );
    }
    setRunning(false);
    await refreshSessions();
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[#f4f7fb] text-slate-800">
      <Sidebar
        sessions={sessions}
        currentId={sessionId}
        onSelect={(id) => void loadSession(id)}
        onNew={startNew}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
          <div>
            <p className="text-sm text-slate-500">AI Agent</p>
            <h1 className="text-lg font-medium text-slate-900">何でも指示してください</h1>
          </div>
          <p className="text-xs text-slate-400">
            Orchestrator → Tools → Verifier
          </p>
        </header>
        <MessageList messages={messages} streaming={running} />
        <ChatInput
          value={input}
          disabled={running}
          onChange={setInput}
          onSubmit={() => void send()}
        />
      </main>
      <ExecutionTrace
        steps={steps}
        summary={summary}
        verification={verification}
        running={running}
      />
    </div>
  );
}
