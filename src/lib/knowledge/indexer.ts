import { createHash } from "crypto";
import { hasGeminiKey } from "../ai/client";
import { prisma } from "../prisma";
import { chunkDocuments, embedTextForChunk } from "./chunk";
import { embedTexts } from "./embeddings";
import { fetchNotionDocs, hasNotionConfig, notionCorpusHash } from "./notion";

function hashSignature(signature: string) {
  return createHash("sha256").update(signature).digest("hex");
}

let indexing: Promise<{ indexed: boolean; count: number; model: string }> | null = null;

async function indexNow() {
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

export async function ensureKnowledgeIndex() {
  if (!indexing) {
    indexing = indexNow().finally(() => {
      indexing = null;
    });
  }
  return indexing;
}
