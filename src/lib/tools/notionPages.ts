/**
 * Notion 操作 Tool。
 * 社内ナレッジと同じデータベースに対して、一覧・新規ページ・本文追記を行う。
 * ユーザーが Notion への作成・追記を依頼したときだけ呼ぶ。
 */
import {
  appendNotionPage,
  createNotionPage,
  listNotionPages,
} from "@/lib/knowledge/notion-write";
import type { JsonValue } from "@/types/tool";

/** 文字列引数を trim して空なら undefined。 */
function optionalText(value: JsonValue | undefined) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
}

/** 対象 DB のページ一覧。query があればタイトルで絞る。 */
export async function listNotionPagesTool(
  args: Record<string, JsonValue>,
): Promise<JsonValue> {
  const query = optionalText(args.query);
  const pages = await listNotionPages(query);
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
  });
  return {
    appended: true,
    saved: true,
    title: page.title,
    pageId: page.id,
    url: page.url,
  };
}
