/** サイドバー用。保存済み会話の一覧（id / タイトル / 更新時刻）。 */
import { listSessions } from "@/lib/store/db";

/** 会話一覧を JSON で返す。失敗しても HTML ではなく JSON を返す。 */
export async function GET() {
  try {
    const sessions = await listSessions();
    return Response.json({ sessions });
  } catch (error) {
    const message = error instanceof Error ? error.message : "sessions の取得に失敗しました";
    return Response.json({ sessions: [], error: message }, { status: 500 });
  }
}
