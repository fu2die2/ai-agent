/**
 * データログ画面用。保存先と件数、チャンクの中身（ベクトルは先頭だけ）を返す。
 */
import { getInspectSnapshot } from "@/lib/inspect/snapshot";

/** いま保持しているデータのスナップショットを JSON で返す。 */
export async function GET() {
  const snapshot = await getInspectSnapshot();
  return Response.json(snapshot);
}
