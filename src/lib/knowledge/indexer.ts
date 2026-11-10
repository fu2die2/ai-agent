/**
 * Notion → チャンク → 埋め込み → knowledge_chunks への書き込み。
 *
 * 毎回 Notion を全文埋め込みすると遅いので、
 * last_edited_time から作った corpusHash が同じならスキップする。
 * 同時に複数検索が来ても embed が二重に走らないよう Promise を共有する。
 */
import { createHash } from "crypto";
import { hasGeminiKey } from "../ai/client";
import { prisma } from "../prisma";
import { chunkDocuments, embedTextForChunk } from "./chunk";
import { embedTexts } from "./embeddings";
import { hasNotionConfig } from "./notion-client";
import { fetchNotionDocs, notionCorpusHash } from "./notion";

/** 署名文字列を SHA-256 にして DB の corpusHash と比較できるようにする。 */
function hashSignature(signature: string) {
  return createHash("sha256").update(signature).digest("hex");
}

let indexing: Promise<{ indexed: boolean; count: number; model: string }> | null = null;

/** Notion 取得から DB 書き込みまでの本体。ハッシュが同じなら何もしない。 */
async function indexNow() {
  // 開発サーバー再起動前は env が空でも、既に作ったチャンクがあればそれを使う
  if (!hasNotionConfig()) {
    const count = await prisma.knowledgeChunk.count();
    if (count > 0) {
      const existing = await prisma.knowledgeChunk.findFirst({
        select: { model: true },
      });
      return { indexed: false, count, model: existing?.model ?? "cached" };
    }
    throw new Error("NOTION_TOKEN と NOTION_DATABASE_ID を設定してください。開発サーバーを起動し直すと .env.local が読み込まれます");
  }

  const docs = await fetchNotionDocs();
  if (docs.length === 0) {
    throw new Error("Notionデータベースから本文付きページを取得できませんでした");
  }

  const hash = hashSignature(notionCorpusHash(docs));
  const existing = await prisma.knowledgeChunk.findFirst({
    select: { corpusHash: true, model: true },
  });
  const count = await prisma.knowledgeChunk.count();
  if (count > 0 && existing?.corpusHash === hash) {
    return { indexed: false, count, model: existing.model };
  }

  const chunks = chunkDocuments(docs);
  // Gemini が無いときは空ベクトルで保存し、検索は語句一致だけになる
  let embeddings = chunks.map(() => [] as number[]);
  let model = "lexical";

  if (hasGeminiKey()) {
    const embedded = await embedTexts({
      texts: chunks.map(embedTextForChunk),
      titles: chunks.map((chunk) => chunk.title),
      taskType: "document",
    });
    embeddings = embedded.embeddings;
    model = embedded.model;
  }

  await prisma.$transaction(async (tx) => {
    await tx.knowledgeChunk.deleteMany();
    await tx.knowledgeChunk.createMany({
      data: chunks.map((chunk, index) => ({
        id: chunk.id,
        documentId: chunk.documentId,
        chunkIndex: chunk.chunkIndex,
        title: chunk.title,
        category: chunk.category,
        source: chunk.source,
        url: chunk.url,
        content: chunk.content,
        keywords: chunk.keywords.join(", "),
        embedding: embeddings[index],
        model,
        corpusHash: hash,
      })),
    });
  });

  return { indexed: true, count: chunks.length, model };
}

/** 検索前に呼ぶ。未作成・古ければ indexNow、実行中なら同じ Promise を待つ。 */
export async function ensureKnowledgeIndex() {
  // 進行中のインデックスを共有し、同時リクエストで Notion/Gemini を連打しない
  if (!indexing) {
    indexing = indexNow().finally(() => {
      indexing = null;
    });
  }
  return indexing;
}
