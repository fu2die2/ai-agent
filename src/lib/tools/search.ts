import { retrieveKnowledge } from "@/lib/knowledge/retrieve";
import type { JsonValue } from "@/types/tool";

export async function searchKnowledge(
  args: Record<string, JsonValue>,
): Promise<JsonValue> {
  const query = String(args.query ?? "");
  if (!query.trim()) {
    return { results: [], mode: "rag", message: "query が空です" };
  }

  try {
    const { mode, results } = await retrieveKnowledge(query, 4);
    if (results.length === 0) {
      return {
        results: [],
        mode,
        message:
          "Notionの社内ナレッジに一致する文書はありませんでした。一般質問なら answerQuestion を使ってください。",
      };
    }

    return {
      mode,
      results: results.map((chunk) => ({
        title: chunk.title,
        category: chunk.category,
        source: chunk.source,
        content: chunk.content,
        score: chunk.score,
      })),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Notionからの取得に失敗しました";
    return {
      results: [],
      mode: "rag",
      error: true,
      message,
    };
  }
}
