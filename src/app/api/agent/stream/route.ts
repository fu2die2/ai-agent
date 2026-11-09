import { runAgent } from "@/lib/agent/orchestrator";
import type { AgentEvent } from "@/types/agent";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    sessionId?: string;
    message?: string;
  };
  const message = body.message?.trim();
  if (!message) {
    return Response.json({ error: "message は必須です" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: AgentEvent) => {
        controller.enqueue(
          encoder.encode(
            `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`,
          ),
        );
      };
      try {
        await runAgent({
          sessionId: body.sessionId || `session_${Date.now()}`,
          message,
          emit,
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
