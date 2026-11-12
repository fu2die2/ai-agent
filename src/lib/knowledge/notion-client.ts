/**
 * Notion SDK の接続だけを担う。
 * 読み取り（notion.ts）と書き込み（notion-write.ts）の両方から使う。
 * ここに他の knowledge モジュールを import しない（循環参照を防ぐ）。
 */
import { Client, extractDatabaseId, isFullDatabase } from "@notionhq/client";

/** 接頭辞なし、または AI_AGENT_NOTION_TOKEN のように接頭辞付きの値を取る。 */
function envExactOrPrefixed(name: string) {
  const exact = process.env[name];
  if (exact) return exact;
  const suffix = `_${name}`;
  for (const [key, value] of Object.entries(process.env)) {
    if (value && key.endsWith(suffix)) return value;
  }
  return "";
}

/** Internal Integration のトークン。NOTION_API_KEY でも可。 */
function notionToken() {
  return envExactOrPrefixed("NOTION_TOKEN") || envExactOrPrefixed("NOTION_API_KEY");
}

/** 対象データベース ID。URL 貼り付けにも対応。 */
export function notionDatabaseId() {
  const raw = envExactOrPrefixed("NOTION_DATABASE_ID");
  return extractDatabaseId(raw) ?? raw.trim();
}

/** 書き込みに必要なトークンがあるか。 */
export function hasNotionToken() {
  return Boolean(notionToken());
}

/** 社内ナレッジ検索に必要なトークンと DB ID が揃っているか。 */
export function hasNotionConfig() {
  return Boolean(notionToken() && notionDatabaseId());
}

/**
 * Notion ページをブラウザで開く URL。
 * API が返す url を優先し、無いときはページ ID から組み立てる。
 */
export function notionPageUrl(pageId: string, pageUrl?: string) {
  if (pageUrl?.startsWith("http")) return pageUrl;
  const compact = pageId.replace(/-/g, "");
  return compact ? `https://www.notion.so/${compact}` : "";
}

/** 認証済み Notion SDK クライアント。書き込みはトークンだけあればよい。 */
export function getNotionClient() {
  if (!hasNotionToken()) {
    throw new Error(
      "NOTION_TOKEN がありません。ローカルは .env.local、本番は Vercel の Environment Variables に設定してください",
    );
  }
  return new Client({ auth: notionToken() });
}

/** データベース ID から、行一覧・作成に使う data_source_id を1つ取る。 */
export async function resolveDataSourceId(client: Client, databaseId = notionDatabaseId()) {
  const id = extractDatabaseId(databaseId) ?? databaseId.trim();
  if (!id) {
    throw new Error("データベース ID が空です");
  }
  const database = await client.databases.retrieve({ database_id: id });
  if (!isFullDatabase(database) || database.data_sources.length === 0) {
    throw new Error("Notionデータベースにデータソースがありません");
  }
  return database.data_sources[0].id;
}
