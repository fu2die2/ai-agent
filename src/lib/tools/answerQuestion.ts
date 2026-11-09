/**
 * answerQuestion Tool。
 * 社内文書ではない一般質問向け。検索は Gemini の Google Search grounding に任せる。
 */
import { generateSearchAnswer, hasGeminiKey } from "@/lib/ai/client";
import type { JsonValue } from "@/types/tool";

/** 一般質問を Gemini（可能なら Google 検索付き）に渡す。 */
export async function answerQuestion(
  args: Record<string, JsonValue>,
): Promise<JsonValue> {
  const question = String(args.question ?? args.query ?? "").trim();
  if (!question) {
    return { answers: [], message: "question が空です" };
  }

  if (!hasGeminiKey()) {
    return {
      question,
      answers: [],
      message: "GEMINI_API_KEY が無いため、モデル検索は実行できません。",
    };
  }

  const result = await generateSearchAnswer(question);
  return {
    question,
    answers: [
      {
        title: result.searched ? "Gemini Search" : "Gemini",
        content: result.text,
        source: result.searched ? "Gemini + Google Search" : "Gemini",
        urls: result.sources.map((item) => item.url).filter(Boolean),
      },
    ],
  };
}
