import { saveMemo } from "@/lib/store/memos";
import type { JsonValue } from "@/types/tool";

export async function saveMemoTool(
  args: Record<string, JsonValue>,
): Promise<JsonValue> {
  const title = String(args.title ?? "無題のメモ").trim();
  const content = String(args.content ?? "").trim();
  if (!content) {
    throw new Error("content が空です");
  }

  const memo = await saveMemo({ title, content });

  return {
    saved: true,
    id: memo.id,
    title: memo.title,
  };
}
