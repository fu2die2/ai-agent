/** サイドバー用。保存済み会話の一覧（id / タイトル / 更新時刻）。 */
import { listSessions } from "@/lib/store/db";

/** 会話一覧を JSON で返す。 */
export async function GET() {
  const sessions = await listSessions();
  return Response.json({ sessions });
}
