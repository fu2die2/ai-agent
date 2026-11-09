import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SessionRecord, SessionSummary } from "@/types/agent";

const DATA_DIR = path.join(process.cwd(), ".data");
const SESSIONS_PATH = path.join(DATA_DIR, "sessions.json");

type StoreFile<T> = { items: T[] };

async function ensureDir() {
  await mkdir(DATA_DIR, { recursive: true });
}

async function readStore<T>(filePath: string): Promise<T[]> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as StoreFile<T>;
    return parsed.items ?? [];
  } catch {
    return [];
  }
}

async function writeStore<T>(filePath: string, items: T[]) {
  await ensureDir();
  await writeFile(filePath, JSON.stringify({ items }, null, 2), "utf8");
}

export async function listSessions(): Promise<SessionSummary[]> {
  const sessions = await readStore<SessionRecord>(SESSIONS_PATH);
  return sessions
    .map(({ id, title, updatedAt }) => ({ id, title, updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getSession(id: string): Promise<SessionRecord | null> {
  const sessions = await readStore<SessionRecord>(SESSIONS_PATH);
  return sessions.find((session) => session.id === id) ?? null;
}

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
