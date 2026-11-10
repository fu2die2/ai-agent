/**
 * メモの永続化（PostgreSQL / Prisma）。
 * saveMemo Tool と /api/memos の両方がここを通る。
 */
import { prisma } from "@/lib/prisma";
import type { Memo } from "@/types/agent";

/** Prisma の Date を UI 用のミリ秒タイムスタンプに変換する。 */
function toMemo(row: { id: string; title: string; content: string; createdAt: Date }): Memo {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    // UI 側は unix ms で扱う
    createdAt: row.createdAt.getTime(),
  };
}

/** メモを新しい順で全部返す。 */
export async function listMemos(): Promise<Memo[]> {
  const rows = await prisma.memo.findMany({
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toMemo);
}

/** メモを1件 INSERT する。 */
export async function saveMemo(input: { title: string; content: string }): Promise<Memo> {
  const row = await prisma.memo.create({
    data: {
      title: input.title,
      content: input.content,
    },
  });
  return toMemo(row);
}

/** メモを1件 DELETE する。無い id でも Prisma はエラーにせず件数 0 を返す。 */
export async function deleteMemo(id: string): Promise<boolean> {
  const result = await prisma.memo.deleteMany({
    where: { id },
  });
  return result.count > 0;
}
