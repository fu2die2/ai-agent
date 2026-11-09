/**
 * エージェントを一括実行する API。
 * ストリーミングせず、完了イベントだけ JSON で返す（curl や検証用）。
 * 画面のチャットは /api/agent/stream を使う。
 */
import { runAgent } from "@/lib/agent/orchestrator";
import type { AgentEvent } from "@/types/agent";

/** message を受け取り、完了結果だけ JSON で返す。 */
export async function POST(request: Request) {
  const body = (await request.json()) as {
    sessionId?: string;
    message?: string;
  };
  const message = body.message?.trim();
  if (!message) {
    return Response.json({ error: "message は必須です" }, { status: 400 });
  }

  let completed: Extract<AgentEvent, { type: "agent.completed" }>["data"] | null =
    null;
  let error: string | undefined;

  await runAgent({
    sessionId: body.sessionId || `session_${Date.now()}`,
    message,
    emit: (event) => {
      if (event.type === "agent.completed") completed = event.data;
      if (event.type === "agent.error") error = event.data.message;
    },
  });

  if (error) {
    return Response.json({ error }, { status: 500 });
  }
  return Response.json(completed);
}
