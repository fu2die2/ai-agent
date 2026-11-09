/** メモ一覧と手動保存。エージェントの saveMemo Tool とは別入口（画面・curl 用）。 */
import { listMemos, saveMemo } from "@/lib/store/memos";

/** 保存済みメモの一覧。 */
export async function GET() {
  const memos = await listMemos();
  return Response.json({ memos });
}

/** メモを1件追加する。content 必須。 */
export async function POST(request: Request) {
  const body = (await request.json()) as { title?: string; content?: string };
  if (!body.content?.trim()) {
    return Response.json({ error: "content は必須です" }, { status: 400 });
  }
  const memo = await saveMemo({
    title: body.title?.trim() || "無題のメモ",
    content: body.content.trim(),
  });
  return Response.json({ memo });
}
