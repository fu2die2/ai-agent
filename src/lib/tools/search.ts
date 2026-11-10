/**
 * searchKnowledge Tool。
 *
 * 社内ナレッジ専用。流れは:
 * 1. Notion から文書を取得してチャンク（未インデックスならここで実施）
 * 2. 質問を埋め込んで近いチャンクを返す
 * 3. エージェントはその抜粋だけを根拠に答える
 */
import { retrieveKnowledge } from "@/lib/knowledge/retrieve";
import type { JsonValue } from "@/types/tool";

/** 社内ナレッジを検索し、上位チャンクを results に入れて返す。 */
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
        url: chunk.url,
        citation: `[${chunk.title}](${chunk.url})`,
        content: chunk.content,
        score: chunk.score,
      })),
    };
  } catch (error) {
    // 例外を throw せず JSON で返す。Trace は Success でも message で原因が残る
    const message = error instanceof Error ? error.message : "Notionからの取得に失敗しました";
    return {
      results: [],
      mode: "rag",
      error: true,
      message,
    };
  }
}
