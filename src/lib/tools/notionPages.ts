/**
 * Notion 操作 Tool。
 * Integration が権限を持つデータベース／親ページへ作成・追記できる。
 * ユーザーが Notion への作成・追記を依頼したときだけ呼ぶ。
 */
import {
  addNotionDatabaseProperty,
  appendNotionPage,
  createNotionPage,
  listNotionDatabases,
  listNotionPages,
  removeNotionDatabaseProperty,
} from "@/lib/knowledge/notion-write";
import type { JsonValue } from "@/types/tool";

/** 文字列引数を trim して空なら undefined。 */
function optionalText(value: JsonValue | undefined) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
}

/** Integration が見えるデータベース一覧。 */
export async function listNotionDatabasesTool(
  args: Record<string, JsonValue>,
): Promise<JsonValue> {
  const query = optionalText(args.query);
  const databases = await listNotionDatabases(query);
  return {
    count: databases.length,
    databases: databases.map((item) => ({
      title: item.title,
      databaseId: item.id,
      url: item.url,
      properties: item.properties,
    })),
  };
}

/** 対象 DB のページ一覧。query があればタイトルで絞る。 */
export async function listNotionPagesTool(
  args: Record<string, JsonValue>,
): Promise<JsonValue> {
  const query = optionalText(args.query);
  const databaseId = optionalText(args.databaseId);
  const pages = await listNotionPages(query, databaseId);
  return {
    count: pages.length,
    pages: pages.map((page) => ({
      title: page.title,
      pageId: page.id,
      url: page.url,
    })),
  };
}

/** 新しい Notion ページを作り、本文を書く。 */
export async function createNotionPageTool(
  args: Record<string, JsonValue>,
): Promise<JsonValue> {
  const title = String(args.title ?? "").trim();
  const content = String(args.content ?? "").trim();
  const page = await createNotionPage({
    title,
    content,
    category: optionalText(args.category),
    keywords: optionalText(args.keywords),
    parentPageId: optionalText(args.parentPageId),
    databaseId: optionalText(args.databaseId),
    databaseTitle: optionalText(args.databaseTitle),
  });
  return {
    created: true,
    saved: true,
    title: page.title,
    pageId: page.id,
    url: page.url,
  };
}

/** 既存ページの末尾に Markdown 本文を追記する。 */
export async function appendNotionPageTool(
  args: Record<string, JsonValue>,
): Promise<JsonValue> {
  const content = String(args.content ?? "").trim();
  const page = await appendNotionPage({
    content,
    pageId: optionalText(args.pageId),
    title: optionalText(args.title),
    databaseId: optionalText(args.databaseId),
  });
  return {
    appended: true,
    saved: true,
    title: page.title,
    pageId: page.id,
    url: page.url,
  };
}

/** データベースに列（プロパティ）を追加する。 */
export async function addNotionDatabasePropertyTool(
  args: Record<string, JsonValue>,
): Promise<JsonValue> {
  const result = await addNotionDatabaseProperty({
    name: String(args.name ?? "").trim(),
    type: String(args.type ?? "rich_text"),
    options: optionalText(args.options),
    databaseId: optionalText(args.databaseId),
    databaseTitle: optionalText(args.databaseTitle),
  });
  return result;
}

/** データベースから列（プロパティ）を削除する。 */
export async function removeNotionDatabasePropertyTool(
  args: Record<string, JsonValue>,
): Promise<JsonValue> {
  return removeNotionDatabaseProperty({
    name: String(args.name ?? "").trim(),
    databaseId: optionalText(args.databaseId),
    databaseTitle: optionalText(args.databaseTitle),
  });
}
