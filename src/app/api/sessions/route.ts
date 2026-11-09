import { listSessions } from "@/lib/store/db";

export async function GET() {
  const sessions = await listSessions();
  return Response.json({ sessions });
}
