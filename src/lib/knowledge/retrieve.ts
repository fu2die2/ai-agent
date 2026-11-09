/**
 * 社内ナレッジの検索本体（RAG）。
 *
 * 1. インデックスが古ければ Notion から作り直す
 * 2. 質問をベクトル化
 * 3. 各チャンクとのコサイン類似度 + 日本語の語句スコアを混ぜて上位を返す
 *
 * 埋め込みが使えないときは語句検索だけに落とす。
 */
import { hasGeminiKey } from "../ai/client";
import { prisma } from "../prisma";
import type { KnowledgeChunkInput } from "./chunk-types";
import { asNumberVector, cosineSimilarity, embedTexts } from "./embeddings";
import { ensureKnowledgeIndex } from "./indexer";

export type RetrievedChunk = {
  title: string;
  category: string;
  source: string;
  content: string;
  documentId: string;
  score: number;
  cosine: number;
  lexical: number;
};

/** 英数字トークンと、日本語は2文字以上の連続を検索語にする。 */
function tokenize(query: string) {
  return (
    query
      .toLowerCase()
      .match(/[a-z0-9]+|[ぁ-んァ-ン一-龯]{2,}/g)
      ?.filter((term) => term.length >= 2) ?? []
  );
}

/** キーワード・タイトル一致を厚く加点する。ベクトルが弱い固有名詞向け。 */
function lexicalScore(
  query: string,
  chunk: Pick<KnowledgeChunkInput, "title" | "category" | "content" | "keywords">,
) {
  const hay = `${chunk.title}\n${chunk.category}\n${chunk.keywords.join("\n")}\n${chunk.content}`.toLowerCase();
  const q = query.toLowerCase();
  let score = 0;
  for (const keyword of chunk.keywords) {
    if (q.includes(keyword.toLowerCase())) score += 10;
  }
  for (const term of tokenize(query)) {
    if (chunk.keywords.some((keyword) => keyword.toLowerCase().includes(term))) score += 8;
    if (chunk.title.toLowerCase().includes(term)) score += 5;
    if (hay.includes(term)) score += 2;
  }
  for (let i = 0; i < q.length - 1; i += 1) {
    const gram = q.slice(i, i + 2);
    if (/[ぁ-んァ-ン一-龯]{2}/.test(gram) && hay.includes(gram)) score += 1;
  }
  return score;
}

/** 配列を最大値で割って 0〜1 にする。類似度と語句スコアを同じ土俵に乗せる。 */
function normalize(values: number[]) {
  const max = Math.max(...values, 1);
  return values.map((value) => value / max);
}

/** DB に保存したカンマ区切り keywords を配列に戻す。 */
function keywordsFrom(value: string) {
  return value
    .split(/[,、]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** 埋め込みが使えないときの順位付け。語句スコアだけの上位 limit 件。 */
function rankLexical(
  query: string,
  rows: { id: string; title: string; category: string; source: string; content: string; keywords: string; documentId: string }[],
  limit: number,
): RetrievedChunk[] {
  return rows
    .map((row) => {
      const lexical = lexicalScore(query, {
        title: row.title,
        category: row.category,
        content: row.content,
        keywords: keywordsFrom(row.keywords),
      });
      return {
        title: row.title,
        category: row.category,
        source: row.source,
        content: row.content,
        documentId: row.documentId,
        score: lexical,
        cosine: 0,
        lexical,
      };
    })
    .filter((chunk) => chunk.lexical > 0)
    .sort((a, b) => b.lexical - a.lexical)
    .slice(0, limit);
}

/** 質問に近いチャンクを最大 limit 件返す。searchKnowledge から呼ばれる。 */
export async function retrieveKnowledge(query: string, limit = 4) {
  await ensureKnowledgeIndex();
  const rows = await prisma.knowledgeChunk.findMany();
  if (rows.length === 0) {
    return { mode: "lexical" as const, results: [] };
  }

  const canEmbed =
    hasGeminiKey() && rows.some((row) => (asNumberVector(row.embedding)?.length ?? 0) > 0);

  if (!canEmbed) {
    return { mode: "lexical" as const, results: rankLexical(query, rows, limit) };
  }

  try {
    const { embeddings } = await embedTexts({
      texts: [query],
      taskType: "query",
    });
    const queryVector = embeddings[0];
    const scored = rows
      .map((row) => {
        const vector = asNumberVector(row.embedding);
        const cosine = vector ? cosineSimilarity(queryVector, vector) : 0;
        const lexical = lexicalScore(query, {
          title: row.title,
          category: row.category,
          content: row.content,
          keywords: keywordsFrom(row.keywords),
        });
        return {
          title: row.title,
          category: row.category,
          source: row.source,
          content: row.content,
          documentId: row.documentId,
          cosine,
          lexical,
          score: 0,
        };
      })
      // どちらも低すぎるチャンクはノイズなので落とす
      .filter((row) => row.cosine > 0.18 || row.lexical > 0);

    // 尺度が違うので 0〜1 に正規化してから加重平均する
    const cosineNorm = normalize(scored.map((row) => Math.max(row.cosine, 0)));
    const lexicalNorm = normalize(scored.map((row) => row.lexical));
    const ranked = scored
      .map((row, index) => ({
        ...row,
        score: Number((0.72 * cosineNorm[index] + 0.28 * lexicalNorm[index]).toFixed(4)),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return { mode: "rag" as const, results: ranked };
  } catch {
    return { mode: "lexical" as const, results: rankLexical(query, rows, limit) };
  }
}
