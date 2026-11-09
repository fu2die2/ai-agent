import { getSession } from "@/lib/store/db";

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
