/**
 * 個別メモの操作。
 * 画面の削除ボタンがここを叩く。
 */
import { deleteMemo } from "@/lib/store/memos";

/** URL の id のメモを消す。無いときは 404。 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!id) {
    return Response.json({ error: "id は必須です" }, { status: 400 });
  }
  const deleted = await deleteMemo(id);
  if (!deleted) {
    return Response.json({ error: "memo not found" }, { status: 404 });
  }
  return Response.json({ deleted: true, id });
}
