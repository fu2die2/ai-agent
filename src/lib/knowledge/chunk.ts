import type { KnowledgeChunkInput } from "./chunk-types";
import type { KnowledgeDoc } from "./types";

export type { KnowledgeChunkInput } from "./chunk-types";

const MAX_CHARS = 700;
const OVERLAP = 80;

function splitDoc(doc: KnowledgeDoc) {
  const blocks = doc.content
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
  const pieces: string[] = [];
  let buffer = "";

  const flush = () => {
    if (buffer.trim()) pieces.push(buffer.trim());
    buffer = "";
  };

  for (const block of blocks) {
    if (block.length > MAX_CHARS) {
      flush();
      for (let i = 0; i < block.length; i += MAX_CHARS - OVERLAP) {
        pieces.push(block.slice(i, i + MAX_CHARS).trim());
      }
      continue;
    }
    if (!buffer) {
      buffer = block;
      continue;
    }
    if (`${buffer}\n${block}`.length > MAX_CHARS) {
      pieces.push(buffer.trim());
      buffer = `${buffer.slice(-OVERLAP)}\n${block}`.trim();
    } else {
      buffer = `${buffer}\n${block}`;
    }
  }
  flush();
  return pieces.length ? pieces : [doc.content.trim()].filter(Boolean);
}

export function chunkDocuments(docs: KnowledgeDoc[]): KnowledgeChunkInput[] {
  return docs.flatMap((doc) =>
    splitDoc(doc).map((content, chunkIndex) => ({
      id: `${doc.id}:${chunkIndex}`,
      documentId: doc.id,
      chunkIndex,
      title: doc.title,
      category: doc.category,
      source: doc.source,
      content,
      keywords: doc.keywords,
    })),
  );
}

export function embedTextForChunk(chunk: KnowledgeChunkInput) {
  return [
    `タイトル: ${chunk.title}`,
    `分類: ${chunk.category}`,
    chunk.keywords.length ? `キーワード: ${chunk.keywords.join(", ")}` : "",
    chunk.content,
  ]
    .filter(Boolean)
    .join("\n");
}
