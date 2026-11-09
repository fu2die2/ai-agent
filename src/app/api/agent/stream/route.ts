/**
 * エージェント実行の SSE エンドポイント。
 *
 * 計画・Tool・検証の途中経過を event: 名付きで流し、
 * AgentStudio が Execution Trace をリアルタイム更新する。
 * runtime は nodejs（Prisma / Notion SDK を使うため Edge にはしない）。
 */
import { runAgent } from "@/lib/agent/orchestrator";
import type { AgentEvent } from "@/types/agent";

export const runtime = "nodejs";

/** message を受け取り、実行中イベントを SSE で流す。 */
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
    /** 購読が始まったらエージェントを走らせ、終わったらストリームを閉じる。 */
    async start(controller) {
      /** Orchestrator からの1イベントを SSE フレームにして送る。 */
      const emit = (event: AgentEvent) => {
        // SSE の1イベント。空行で区切るのが仕様
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
