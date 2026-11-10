/**
 * Notion への書き込み。
 * 対象は .env の NOTION_DATABASE_ID が指すデータベース（社内ナレッジと同じ）。
 *
 * 作成は pages.create、追記は blocks.children.append。
 * 本文は Markdown を見出し・箇条書き・段落のブロックに落とす。
 */
import {
  extractPageId,
  isFullDataSource,
  isFullPage,
  type BlockObjectRequest,
  type DataSourceObjectResponse,
  type PageObjectResponse,
} from "@notionhq/client";
import {
  getNotionClient,
  notionPageUrl,
  resolveDataSourceId,
} from "./notion-client";

const MAX_BLOCKS = 100;
const MAX_RICH_TEXT = 1900;

export type NotionPageSummary = {
  id: string;
  title: string;
  url: string;
};

/** URL やハイフン無し ID を Notion の page_id に揃える。 */
export function normalizePageId(raw: string) {
  const trimmed = raw.trim();
  const extracted = extractPageId(trimmed) ?? extractPageId(`https://www.notion.so/${trimmed}`);
  return extracted || trimmed;
}

/** 1ブロック分の rich_text。2000 文字制限を分割して守る。 */
function richText(content: string): Array<{ type: "text"; text: { content: string } }> {
  const text = content.slice(0, MAX_RICH_TEXT * 2);
  if (!text) return [{ type: "text", text: { content: "" } }];
  const parts: Array<{ type: "text"; text: { content: string } }> = [];
  for (let i = 0; i < text.length; i += MAX_RICH_TEXT) {
    parts.push({ type: "text", text: { content: text.slice(i, i + MAX_RICH_TEXT) } });
  }
  return parts;
}

/** Markdown を Notion ブロック列にする。表や画像は段落として残す。 */
export function markdownToBlocks(markdown: string): BlockObjectRequest[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: BlockObjectRequest[] = [];

  /** ブロックを上限まで積む。 */
  const push = (block: BlockObjectRequest) => {
    if (blocks.length < MAX_BLOCKS) blocks.push(block);
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("### ")) {
      push({ heading_3: { rich_text: richText(trimmed.slice(4)) } });
      continue;
    }
    if (trimmed.startsWith("## ")) {
      push({ heading_2: { rich_text: richText(trimmed.slice(3)) } });
      continue;
    }
    if (trimmed.startsWith("# ")) {
      push({ heading_1: { rich_text: richText(trimmed.slice(2)) } });
      continue;
    }
    if (/^[-*] /.test(trimmed)) {
      push({ bulleted_list_item: { rich_text: richText(trimmed.slice(2)) } });
      continue;
    }
    const numbered = trimmed.match(/^\d+\.\s+(.*)$/);
    if (numbered) {
      push({ numbered_list_item: { rich_text: richText(numbered[1]) } });
      continue;
    }
    if (trimmed.startsWith("> ")) {
      push({ quote: { rich_text: richText(trimmed.slice(2)) } });
      continue;
    }
    push({ paragraph: { rich_text: richText(trimmed) } });
  }

  if (blocks.length === 0) {
    push({ paragraph: { rich_text: richText(markdown.trim() || " ") } });
  }
  return blocks;
}

/** データソースのスキーマ。タイトル列名と任意プロパティの型を知る。 */
async function loadDataSource() {
  const client = getNotionClient();
  const dataSourceId = await resolveDataSourceId(client);
  const dataSource = await client.dataSources.retrieve({ data_source_id: dataSourceId });
  if (!isFullDataSource(dataSource)) {
    throw new Error("Notionデータソースを取得できませんでした");
  }
  return { client, dataSource };
}

/** title 型のプロパティ名。無いデータベースは作れない。 */
function titlePropertyName(dataSource: DataSourceObjectResponse) {
  const entry = Object.entries(dataSource.properties).find(([, property]) => property.type === "title");
  if (!entry) throw new Error("Notionデータベースにタイトル列がありません");
  return entry[0];
}

/** 名前候補に一致するプロパティ定義。 */
function findSchemaProperty(
  dataSource: DataSourceObjectResponse,
  candidates: string[],
) {
  const entries = Object.entries(dataSource.properties);
  for (const name of candidates) {
    const exact = entries.find(([key]) => key === name);
    if (exact) return exact;
  }
  const lowered = candidates.map((name) => name.toLowerCase());
  return entries.find(([key]) => lowered.some((name) => key.toLowerCase().includes(name)));
}

/** カテゴリ・キーワードなど、存在する列だけ properties に載せる。 */
function extraProperties(
  dataSource: DataSourceObjectResponse,
  input: { category?: string; keywords?: string },
) {
  const properties: Record<string, unknown> = {};
  if (input.category?.trim()) {
    const found = findSchemaProperty(dataSource, ["カテゴリ", "category"]);
    if (found) {
      const [name, config] = found;
      const value = input.category.trim();
      if (config.type === "select" || config.type === "status") {
        properties[name] = { [config.type]: { name: value } };
      } else if (config.type === "rich_text") {
        properties[name] = { rich_text: richText(value) };
      }
    }
  }
  if (input.keywords?.trim()) {
    const found = findSchemaProperty(dataSource, ["キーワード", "keywords", "tags"]);
    if (found) {
      const [name, config] = found;
      const value = input.keywords.trim();
      if (config.type === "multi_select") {
        properties[name] = {
          multi_select: value
            .split(/[,、]/)
            .map((item) => item.trim())
            .filter(Boolean)
            .map((item) => ({ name: item })),
        };
      } else if (config.type === "rich_text") {
        properties[name] = { rich_text: richText(value) };
      }
    }
  }
  return properties;
}

/** ページの title 列から表示名を取る。 */
function pageTitle(page: PageObjectResponse) {
  const titled = Object.values(page.properties).find((property) => property.type === "title");
  if (titled?.type === "title") {
    const text = titled.title.map((item) => item.plain_text).join("").trim();
    if (text) return text;
  }
  return "無題";
}

/** 作成・取得したページを Tool 戻り値の形にする。 */
function asSummary(page: PageObjectResponse): NotionPageSummary {
  return {
    id: page.id,
    title: pageTitle(page),
    url: notionPageUrl(page.id, page.url),
  };
}

/** 対象 DB のページを新しい順で一覧する。query があればタイトル部分一致。 */
export async function listNotionPages(query?: string): Promise<NotionPageSummary[]> {
  const { client, dataSource } = await loadDataSource();
  const titleName = titlePropertyName(dataSource);
  const needle = query?.trim();
  const pages: NotionPageSummary[] = [];
  let cursor: string | undefined;

  do {
    const response = await client.dataSources.query({
      data_source_id: dataSource.id,
      start_cursor: cursor,
      page_size: 100,
      sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
      ...(needle
        ? {
            filter: {
              property: titleName,
              title: { contains: needle },
            },
          }
        : {}),
    });
    for (const item of response.results) {
      if (!isFullPage(item) || item.in_trash) continue;
      pages.push(asSummary(item));
    }
    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return pages;
}

/** タイトル完全一致を優先し、無ければ部分一致の先頭を返す。 */
export async function findNotionPageByTitle(title: string) {
  const pages = await listNotionPages(title);
  const exact = pages.find((page) => page.title === title);
  return exact ?? pages[0] ?? null;
}

/** 社内ナレッジ DB にページを1件作り、本文を書く。 */
export async function createNotionPage(input: {
  title: string;
  content: string;
  category?: string;
  keywords?: string;
}): Promise<NotionPageSummary> {
  const title = input.title.trim();
  const content = input.content.trim();
  if (!title) throw new Error("title は必須です");
  if (!content) throw new Error("content は必須です");

  const { client, dataSource } = await loadDataSource();
  const titleName = titlePropertyName(dataSource);
  const properties = {
    [titleName]: { title: richText(title.slice(0, MAX_RICH_TEXT)) },
    ...extraProperties(dataSource, input),
  };

  const created = await client.pages.create({
    parent: { data_source_id: dataSource.id },
    properties: properties as Parameters<typeof client.pages.create>[0]["properties"],
    children: markdownToBlocks(content),
  });
  if (!isFullPage(created)) throw new Error("ページ作成の応答が不完全です");
  return asSummary(created);
}

/** 既存ページの末尾に本文を追記する。pageId か title のどちらかが必要。 */
export async function appendNotionPage(input: {
  content: string;
  pageId?: string;
  title?: string;
}): Promise<NotionPageSummary> {
  const content = input.content.trim();
  if (!content) throw new Error("content は必須です");

  let pageId = input.pageId?.trim() ? normalizePageId(input.pageId) : "";
  if (!pageId && input.title?.trim()) {
    const found = await findNotionPageByTitle(input.title.trim());
    if (!found) throw new Error(`タイトルに一致するページがありません: ${input.title}`);
    pageId = found.id;
  }
  if (!pageId) throw new Error("pageId または title が必要です");

  const client = getNotionClient();
  await client.blocks.children.append({
    block_id: pageId,
    children: markdownToBlocks(content),
  });
  const page = await client.pages.retrieve({ page_id: pageId });
  if (!isFullPage(page)) throw new Error("追記先のページを取得できませんでした");
  return asSummary(page);
}
