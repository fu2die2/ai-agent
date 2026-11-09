import { prisma } from "@/lib/prisma";
import type { Memo } from "@/types/agent";

function toMemo(row: { id: string; title: string; content: string; createdAt: Date }): Memo {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    createdAt: row.createdAt.getTime(),
  };
}

export async function listMemos(): Promise<Memo[]> {
  const rows = await prisma.memo.findMany({
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toMemo);
}

export async function saveMemo(input: { title: string; content: string }): Promise<Memo> {
  const row = await prisma.memo.create({
    data: {
      title: input.title,
      content: input.content,
    },
  });
  return toMemo(row);
}
