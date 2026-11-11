/**
 * 会話セッションの保存。
 *
 * Vercel の Functions は .data に書けない（/var/task は読み取り専用）ため、
 * メモと同じ PostgreSQL に置く。
 */
import { prisma } from "@/lib/prisma";
import type { SessionRecord, SessionSummary } from "@/types/agent";
import type { Prisma } from "@prisma/client";

/** DB の JSON 列を SessionRecord に戻す。 */
function toSession(row: { id: string; title: string; updatedAt: Date; payload: Prisma.JsonValue }): SessionRecord {
  const payload = (row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
    ? row.payload
    : {}) as Omit<SessionRecord, "id" | "title" | "updatedAt">;
  return {
    id: row.id,
    title: row.title,
    updatedAt: row.updatedAt.getTime(),
    messages: payload.messages ?? [],
    traces: payload.traces ?? [],
    toolExecutions: payload.toolExecutions ?? [],
    eventLog: payload.eventLog,
    lastAnswer: payload.lastAnswer,
    verification: payload.verification,
  };
}

/** サイドバー用の会話一覧。新しい順。 */
export async function listSessions(): Promise<SessionSummary[]> {
  const rows = await prisma.chatSession.findMany({
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, updatedAt: true },
  });
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    updatedAt: row.updatedAt.getTime(),
  }));
}

/** 会話 ID で1件取る。履歴クリック時。 */
export async function getSession(id: string): Promise<SessionRecord | null> {
  const row = await prisma.chatSession.findUnique({ where: { id } });
  return row ? toSession(row) : null;
}

/** 会話を追加または上書きする。エージェント完了時に呼ぶ。 */
export async function saveSession(session: SessionRecord) {
  const payload = JSON.parse(
    JSON.stringify({
      messages: session.messages,
      traces: session.traces,
      toolExecutions: session.toolExecutions,
      eventLog: session.eventLog ?? [],
      lastAnswer: session.lastAnswer,
      verification: session.verification,
    }),
  ) as Prisma.InputJsonValue;

  await prisma.chatSession.upsert({
    where: { id: session.id },
    create: {
      id: session.id,
      title: session.title,
      updatedAt: new Date(session.updatedAt),
      payload,
    },
    update: {
      title: session.title,
      updatedAt: new Date(session.updatedAt),
      payload,
    },
  });
}
