/**
 * saveMemo Tool。
 * ユーザーが「メモに保存して」と言ったときだけ Orchestrator が呼ぶ想定。
 */
import { saveMemo } from "@/lib/store/memos";
import type { JsonValue } from "@/types/tool";

/** 引数の title / content を Postgres に保存し、saved: true を返す。 */
export async function saveMemoTool(
  args: Record<string, JsonValue>,
): Promise<JsonValue> {
  const title = String(args.title ?? "無題のメモ").trim();
  const content = String(args.content ?? "").trim();
  if (!content) {
    throw new Error("content が空です");
  }

  const memo = await saveMemo({ title, content });

  // Verifier は結果 JSON に "saved" があるかで保存済みか判定する
  return {
    saved: true,
    id: memo.id,
    title: memo.title,
  };
}
