import { runAgent } from "@/lib/agent/orchestrator";
import type { AgentEvent } from "@/types/agent";

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
