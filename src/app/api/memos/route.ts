import { listMemos, saveMemo } from "@/lib/store/db";

export async function GET() {
  const memos = await listMemos();
  return Response.json({ memos });
}

export async function POST(request: Request) {
  const body = (await request.json()) as { title?: string; content?: string };
  if (!body.content?.trim()) {
    return Response.json({ error: "content は必須です" }, { status: 400 });
  }
  const memo = await saveMemo({
    id: `memo_${Date.now()}`,
    title: body.title?.trim() || "無題のメモ",
    content: body.content.trim(),
    createdAt: Date.now(),
  });
  return Response.json({ memo });
}
