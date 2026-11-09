/**
 * 1会話の全文を返す。
 * Next.js 16 では params が Promise なので await が必要。
 */
import { getSession } from "@/lib/store/db";

/** URL の id に対応する会話全文を返す。無ければ 404。 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const session = await getSession(id);
  if (!session) {
    return Response.json({ error: "session not found" }, { status: 404 });
  }
  return Response.json({ session });
}
