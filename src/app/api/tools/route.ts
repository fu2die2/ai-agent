/** 登録済み Tool の一覧。許可セットの確認用。 */
import { listTools } from "@/lib/tools/registry";

/** 許可されている Tool 定義を返す。 */
export async function GET() {
  return Response.json({ tools: listTools() });
}
