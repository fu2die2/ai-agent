/**
 * Gemini でテキストをベクトル化する。
 *
 * 文書側は RETRIEVAL_DOCUMENT、質問側は RETRIEVAL_QUERY を指定する。
 * 同じ空間で近いものほど意味が近い、という前提で retrieve.ts がコサイン類似度を取る。
 * この環境には pgvector が無いので、数値配列を JSON として Postgres に保存する。
 */
import { TaskType } from "@google/generative-ai";
import { getGemini, hasGeminiKey } from "../ai/client";

const EMBEDDING_MODELS = [
  process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-001",
  "gemini-embedding-001",
  "gemini-embedding-2",
];

/** 環境変数とデフォルトを重複なく並べた埋め込みモデル候補。 */
function uniqueModels() {
  return [...new Set(EMBEDDING_MODELS.filter(Boolean))];
}

/** catch した値をメッセージ文字列にする。 */
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** テキスト配列をベクトル化する。document と query で taskType を分ける。 */
export async function embedTexts(params: {
  texts: string[];
  taskType: "document" | "query";
  titles?: string[];
}) {
  if (!hasGeminiKey()) {
    throw new Error("GEMINI_API_KEY がありません");
  }

  let lastError: unknown;
  for (const modelName of uniqueModels()) {
    try {
      const model = getGemini().getGenerativeModel({ model: modelName });
      const embeddings: number[][] = [];
      // 無料枠ではバッチより1件ずつが安定しやすい
      for (let i = 0; i < params.texts.length; i += 1) {
        const request = {
          content: { role: "user" as const, parts: [{ text: params.texts[i] }] },
          taskType:
            params.taskType === "query"
              ? TaskType.RETRIEVAL_QUERY
              : TaskType.RETRIEVAL_DOCUMENT,
          title:
            params.taskType === "document" ? params.titles?.[i] : undefined,
        };
        const result = await model.embedContent(request);
        const values = result.embedding.values;
        if (!values?.length) {
          throw new Error("埋め込みベクトルが空です");
        }
        embeddings.push(values);
      }
      return { embeddings, model: modelName };
    } catch (error) {
      lastError = error;
      const message = errorMessage(error);
      if (message.includes("429") || message.includes("quota")) {
        throw error;
      }
      // モデル名が古い・非対応なら次の候補へ
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("埋め込みモデルを利用できませんでした");
}

/** 2ベクトルの向きの近さ。1 に近いほど似ている。次元が違っても短い方に合わせる。 */
export function cosineSimilarity(a: number[], b: number[]) {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Prisma の Json が数値配列ならそのまま返す。壊れていたら null。 */
export function asNumberVector(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (!value.every((item) => typeof item === "number" && Number.isFinite(item))) {
    return null;
  }
  return value;
}
