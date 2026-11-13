/**
 * データログ画面用のスナップショット。
 * どこに何が保存されているかを、秘密情報を除いて返す。
 */
import { hasGeminiKey } from "@/lib/ai/client";
import { asNumberVector } from "@/lib/knowledge/embeddings";
import { hasNotionConfig, notionPageUrl } from "@/lib/knowledge/notion-client";
import { prisma } from "@/lib/prisma";
import { listSessions } from "@/lib/store/db";
import { listMemos } from "@/lib/store/memos";
import type { InspectSnapshot } from "@/types/inspect";

/** Json 列のベクトルを、次元数と先頭8件だけにする（画面が埋まらないように）。 */
function embeddingView(value: unknown) {
  const vector = asNumberVector(value);
  if (!vector) {
    return { embeddingDims: 0, embeddingPreview: [] as number[] };
  }
  return {
    embeddingDims: vector.length,
    embeddingPreview: vector.slice(0, 8),
  };
}

/** チャット〜検索〜保存までのデータの置き場を説明する固定の流れ。 */
function flowSteps() {
  return [
    { step: "1. ユーザー入力", detail: "ブラウザのチャット。送信後はセッションの messages に入る" },
    { step: "2. Orchestrator", detail: "Gemini が Tool を選ぶ。入出力は session.ioLogs（全発言ぶん）と SSE" },
    { step: "3. searchKnowledge", detail: "Notion → チャンク → embedding。本体は PostgreSQL knowledge_chunks" },
    { step: "4. その他 Tool", detail: "calculate はメモリ上、saveMemo は PostgreSQL memos。createNotionPage / appendNotionPage は Notion DB へ書き込み" },
    { step: "5. Verifier / 回答", detail: "session.verification と lastAnswer。会話全体は PostgreSQL chat_sessions" },
  ];
}

/** 画面と /api/inspect が使う、いまのデータの持ち方。 */
export async function getInspectSnapshot(): Promise<InspectSnapshot> {
  let sessions: InspectSnapshot["stores"]["sessions"]["items"] = [];
  let memos: InspectSnapshot["stores"]["memos"]["items"] = [];
  let chunks: Awaited<ReturnType<typeof prisma.knowledgeChunk.findMany>> = [];
  try {
    sessions = await listSessions();
    memos = await listMemos();
    chunks = await prisma.knowledgeChunk.findMany({
      orderBy: [{ documentId: "asc" }, { chunkIndex: "asc" }],
    });
  } catch {
    // DB が落ちていても画面の骨格は返す
  }

  return {
    generatedAt: Date.now(),
    env: {
      gemini: hasGeminiKey(),
      notion: hasNotionConfig(),
      database: Boolean(process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL),
    },
    stores: {
      sessions: {
        where: "PostgreSQL / chat_sessions",
        count: sessions.length,
        items: sessions,
      },
      knowledgeChunks: {
        where: "PostgreSQL / knowledge_chunks",
        count: chunks.length,
        model: chunks[0]?.model ?? null,
        corpusHash: chunks[0]?.corpusHash ?? null,
        items: chunks.map((chunk) => ({
          id: chunk.id,
          documentId: chunk.documentId,
          chunkIndex: chunk.chunkIndex,
          title: chunk.title,
          category: chunk.category,
          source: chunk.source,
          url: notionPageUrl(chunk.documentId, chunk.url),
          keywords: chunk.keywords,
          content: chunk.content,
          contentChars: chunk.content.length,
          ...embeddingView(chunk.embedding),
          model: chunk.model,
          corpusHash: chunk.corpusHash,
          createdAt: chunk.createdAt.toISOString(),
        })),
      },
      memos: {
        where: "PostgreSQL / memos",
        count: memos.length,
        items: memos,
      },
    },
    flow: flowSteps(),
  };
}
