/**
 * 長いページを検索しやすい長さに分割する。
 *
 * 1チャンクが長すぎると埋め込みの焦点がぼやけ、
 * 短すぎると「本社の住所」のような一文が文脈から切れる。
 * 空行（段落）を優先し、はみ出すときだけ文字数で切る。
 */
import type { KnowledgeChunkInput } from "./chunk-types";
import type { KnowledgeDoc } from "./types";

export type { KnowledgeChunkInput } from "./chunk-types";

const MAX_CHARS = 700;
/** 切れ目で文脈が消えないよう、前のチャンク末尾を少し重ねる */
const OVERLAP = 80;

/** 1ページを段落優先で切り、長すぎる段落だけ文字数で分割する。 */
function splitDoc(doc: KnowledgeDoc) {
  const blocks = doc.content
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
  const pieces: string[] = [];
  let buffer = "";

  /** バッファに溜めた段落を1チャンクとして確定する。 */
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

/** 全ページをチャンク配列にする。id は「ページID:番号」。 */
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

/** 埋め込み用テキスト。タイトルと分類も入れて「会社概要」と本文を結びつけやすくする。 */
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
