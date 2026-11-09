/**
 * 会話セッションの保存。
 *
 * メモは PostgreSQL、セッションはまだ .data/sessions.json のファイル保存。
 * サーバー再起動後も履歴サイドバーから会話を開けるようにするため。
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SessionRecord, SessionSummary } from "@/types/agent";

const DATA_DIR = path.join(process.cwd(), ".data");
const SESSIONS_PATH = path.join(DATA_DIR, "sessions.json");

type StoreFile<T> = { items: T[] };

/** .data ディレクトリが無ければ作る。 */
async function ensureDir() {
  await mkdir(DATA_DIR, { recursive: true });
}

/** JSON ファイルから items 配列を読む。無い・壊れているときは空。 */
async function readStore<T>(filePath: string): Promise<T[]> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as StoreFile<T>;
    return parsed.items ?? [];
  } catch {
    // ファイルが無い初回は空配列
    return [];
  }
}

/** items 全体を JSON で上書き保存する。 */
async function writeStore<T>(filePath: string, items: T[]) {
  await ensureDir();
  await writeFile(filePath, JSON.stringify({ items }, null, 2), "utf8");
}

/** サイドバー用の会話一覧。新しい順。 */
export async function listSessions(): Promise<SessionSummary[]> {
  const sessions = await readStore<SessionRecord>(SESSIONS_PATH);
  return sessions
    .map(({ id, title, updatedAt }) => ({ id, title, updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 会話 ID で1件取る。履歴クリック時。 */
export async function getSession(id: string): Promise<SessionRecord | null> {
  const sessions = await readStore<SessionRecord>(SESSIONS_PATH);
  return sessions.find((session) => session.id === id) ?? null;
}

/** 会話を追加または上書きする。エージェント完了時に呼ぶ。 */
export async function saveSession(session: SessionRecord) {
  const sessions = await readStore<SessionRecord>(SESSIONS_PATH);
  const index = sessions.findIndex((item) => item.id === session.id);
  if (index >= 0) {
    sessions[index] = session;
  } else {
    sessions.push(session);
  }
  await writeStore(SESSIONS_PATH, sessions);
}
