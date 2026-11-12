/**
 * 会話セッションの保存。
 *
 * Vercel の Functions は .data に書けない（/var/task は読み取り専用）ため、
 * メモと同じ PostgreSQL に置く。
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SessionRecord, SessionSummary } from "@/types/agent";

/** テーブル未作成（migrate 前）の Prisma エラー。 */
function isMissingTable(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021";
}

let ensuring: Promise<void> | null = null;

/** chat_sessions が無ければ作る。 */
async function ensureChatSessionsTable() {
  if (!ensuring) {
    ensuring = prisma
      .$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "chat_sessions" (
          "id" TEXT NOT NULL,
          "title" TEXT NOT NULL,
          "updatedAt" TIMESTAMP(3) NOT NULL,
          "payload" JSONB NOT NULL,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id")
        )
      `)
      .then(() =>
        prisma.$executeRawUnsafe(
          `CREATE INDEX IF NOT EXISTS "chat_sessions_updatedAt_idx" ON "chat_sessions"("updatedAt")`,
        ),
      )
      .then(() => undefined)
      .catch((error) => {
        ensuring = null;
        throw error;
      });
  }
  await ensuring;
}

/** テーブル無しなら作ってから fn をやり直す。 */
async function withChatSessions<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!isMissingTable(error)) throw error;
    await ensureChatSessionsTable();
    return fn();
  }
}

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
  return withChatSessions(async () => {
    const rows = await prisma.chatSession.findMany({
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, updatedAt: true },
    });
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      updatedAt: row.updatedAt.getTime(),
    }));
  });
}

/** 会話 ID で1件取る。履歴クリック時。 */
export async function getSession(id: string): Promise<SessionRecord | null> {
  return withChatSessions(async () => {
    const row = await prisma.chatSession.findUnique({ where: { id } });
    return row ? toSession(row) : null;
  });
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

  await withChatSessions(() =>
    prisma.chatSession.upsert({
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
    }),
  );
}
