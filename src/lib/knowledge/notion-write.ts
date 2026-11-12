/**
 * Notion への書き込み。
 * 社内ナレッジ DB 以外にも、Integration がアクセスできる DB・親ページへ作れる。
 *
 * 作成は pages.create、追記は blocks.children.append。
 * 本文は Markdown を見出し・箇条書き・段落のブロックに落とす。
 */
import {
  extractDatabaseId,
  extractPageId,
  isFullDataSource,
  isFullPage,
  type BlockObjectRequest,
  type DataSourceObjectResponse,
  type PageObjectResponse,
} from "@notionhq/client";
import {
  getNotionClient,
  notionDatabaseId,
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

export type NotionDatabaseSummary = {
  id: string;
  dataSourceId: string;
  title: string;
  url: string;
  properties: { name: string; type: string }[];
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

/** data_source の表示名。 */
function dataSourceTitle(dataSource: DataSourceObjectResponse) {
  const text = dataSource.title.map((item) => item.plain_text).join("").trim();
  return text || "無題のデータベース";
}

/** データソースのスキーマ。databaseId が空なら社内ナレッジ DB。 */
async function loadDataSource(databaseId?: string) {
  const client = getNotionClient();
  const raw = (databaseId || notionDatabaseId()).trim();
  const compact = extractDatabaseId(raw) ?? raw;
  try {
    const byDataSource = await client.dataSources.retrieve({ data_source_id: compact });
    if (isFullDataSource(byDataSource)) {
      return { client, dataSource: byDataSource };
    }
  } catch {
    // データベース ID の可能性があるので retrieve に進む
  }
  const dataSourceId = await resolveDataSourceId(client, compact);
  const dataSource = await client.dataSources.retrieve({ data_source_id: dataSourceId });
  if (!isFullDataSource(dataSource)) {
    throw new Error("Notionデータソースを取得できませんでした");
  }
  return { client, dataSource };
}

/** Integration が見えるデータベースを search で列挙する。 */
export async function listNotionDatabases(query?: string): Promise<NotionDatabaseSummary[]> {
  const client = getNotionClient();
  const needle = query?.trim();
  const items: NotionDatabaseSummary[] = [];
  let cursor: string | undefined;

  do {
    const response = await client.search({
      query: needle || undefined,
      filter: { property: "object", value: "data_source" },
      start_cursor: cursor,
      page_size: 100,
    });
    for (const result of response.results) {
      if (!isFullDataSource(result) || result.in_trash) continue;
      items.push({
        id: result.id,
        dataSourceId: result.id,
        title: dataSourceTitle(result),
        url: result.url,
        properties: Object.entries(result.properties).map(([name, property]) => ({
          name,
          type: property.type,
        })),
      });
    }
    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return items;
}

/** 名前の完全一致を優先し、無ければ部分一致の先頭。 */
async function findDatabaseByTitle(title: string) {
  const databases = await listNotionDatabases(title);
  const exact = databases.find((item) => item.title === title);
  return exact ?? databases[0] ?? null;
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
export async function listNotionPages(query?: string, databaseId?: string): Promise<NotionPageSummary[]> {
  const { client, dataSource } = await loadDataSource(databaseId);
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
export async function findNotionPageByTitle(title: string, databaseId?: string) {
  const pages = await listNotionPages(title, databaseId);
  const exact = pages.find((page) => page.title === title);
  return exact ?? pages[0] ?? null;
}

/** 親ページの下、または指定 DB（省略時は社内ナレッジ）にページを1件作る。 */
export async function createNotionPage(input: {
  title: string;
  content: string;
  category?: string;
  keywords?: string;
  parentPageId?: string;
  databaseId?: string;
  databaseTitle?: string;
}): Promise<NotionPageSummary> {
  const title = input.title.trim();
  const content = input.content.trim();
  if (!title) throw new Error("title は必須です");
  if (!content) throw new Error("content は必須です");

  const client = getNotionClient();
  const parentPageId = input.parentPageId?.trim() ? normalizePageId(input.parentPageId) : "";

  if (parentPageId) {
    const created = await client.pages.create({
      parent: { page_id: parentPageId },
      properties: {
        title: { title: richText(title.slice(0, MAX_RICH_TEXT)) },
      },
      children: markdownToBlocks(content),
    });
    if (!isFullPage(created)) throw new Error("ページ作成の応答が不完全です");
    return asSummary(created);
  }

  let databaseId = input.databaseId?.trim()
    ? (extractDatabaseId(input.databaseId) ?? input.databaseId.trim())
    : "";
  if (!databaseId && input.databaseTitle?.trim()) {
    const found = await findDatabaseByTitle(input.databaseTitle.trim());
    if (!found) throw new Error(`データベースが見つかりません: ${input.databaseTitle}`);
    databaseId = found.id;
  }

  const { dataSource } = await loadDataSource(databaseId || undefined);
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
  databaseId?: string;
}): Promise<NotionPageSummary> {
  const content = input.content.trim();
  if (!content) throw new Error("content は必須です");

  let pageId = input.pageId?.trim() ? normalizePageId(input.pageId) : "";
  if (!pageId && input.title?.trim()) {
    const found = await findNotionPageByTitle(input.title.trim(), input.databaseId);
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

const PROPERTY_TYPES = [
  "rich_text",
  "number",
  "select",
  "multi_select",
  "url",
  "checkbox",
  "date",
] as const;

type PropertyType = (typeof PROPERTY_TYPES)[number];

/** 日本語の型名を Notion の type に揃える。 */
function normalizePropertyType(raw: string): PropertyType {
  const value = raw.trim().toLowerCase();
  const aliases: Record<string, PropertyType> = {
    text: "rich_text",
    テキスト: "rich_text",
    文章: "rich_text",
    rich_text: "rich_text",
    number: "number",
    数値: "number",
    select: "select",
    セレクト: "select",
    選択: "select",
    multi_select: "multi_select",
    マルチセレクト: "multi_select",
    タグ: "multi_select",
    url: "url",
    リンク: "url",
    checkbox: "checkbox",
    チェック: "checkbox",
    date: "date",
    日付: "date",
  };
  const type = aliases[value];
  if (!type) {
    throw new Error(`未対応のプロパティ型です: ${raw}（rich_text / number / select / multi_select / url / checkbox / date）`);
  }
  return type;
}

/** select / multi_select の選択肢。カンマ区切り。 */
function selectOptions(raw?: string) {
  return (raw ?? "")
    .split(/[,、]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((name) => ({ name }));
}

/** Notion の properties 更新用オブジェクトを型ごとに作る。 */
function propertyConfig(type: PropertyType, options?: string) {
  switch (type) {
    case "rich_text":
      return { type: "rich_text" as const, rich_text: {} };
    case "number":
      return { type: "number" as const, number: {} };
    case "select":
      return { type: "select" as const, select: { options: selectOptions(options) } };
    case "multi_select":
      return { type: "multi_select" as const, multi_select: { options: selectOptions(options) } };
    case "url":
      return { type: "url" as const, url: {} };
    case "checkbox":
      return { type: "checkbox" as const, checkbox: {} };
    case "date":
      return { type: "date" as const, date: {} };
  }
}

/** データベースに列（プロパティ）を1つ追加する。同名があれば作らず既存を返す。 */
export async function addNotionDatabaseProperty(input: {
  name: string;
  type: string;
  options?: string;
  databaseId?: string;
  databaseTitle?: string;
}) {
  const name = input.name.trim();
  if (!name) throw new Error("name は必須です");
  const type = normalizePropertyType(input.type);

  let databaseId = input.databaseId?.trim() ?? "";
  if (!databaseId && input.databaseTitle?.trim()) {
    const found = await findDatabaseByTitle(input.databaseTitle.trim());
    if (!found) throw new Error(`データベースが見つかりません: ${input.databaseTitle}`);
    databaseId = found.id;
  }

  const { client, dataSource } = await loadDataSource(databaseId || undefined);
  const existing = dataSource.properties[name];
  if (existing) {
    return {
      added: false,
      existed: true,
      name,
      type: existing.type,
      databaseTitle: dataSourceTitle(dataSource),
      url: dataSource.url,
    };
  }

  const updated = await client.dataSources.update({
    data_source_id: dataSource.id,
    properties: {
      [name]: propertyConfig(type, input.options),
    },
  });
  if (!isFullDataSource(updated)) {
    throw new Error("プロパティ追加の応答が不完全です");
  }
  return {
    added: true,
    existed: false,
    name,
    type,
    databaseTitle: dataSourceTitle(updated),
    url: updated.url,
  };
}

/** データベースから列（プロパティ）を1つ削除する。タイトル列は消せない。 */
export async function removeNotionDatabaseProperty(input: {
  name: string;
  databaseId?: string;
  databaseTitle?: string;
}) {
  const name = input.name.trim();
  if (!name) throw new Error("name は必須です");

  let databaseId = input.databaseId?.trim() ?? "";
  if (!databaseId && input.databaseTitle?.trim()) {
    const found = await findDatabaseByTitle(input.databaseTitle.trim());
    if (!found) throw new Error(`データベースが見つかりません: ${input.databaseTitle}`);
    databaseId = found.id;
  }

  const { client, dataSource } = await loadDataSource(databaseId || undefined);
  const found = findSchemaProperty(dataSource, [name]);
  if (!found) {
    const names = Object.keys(dataSource.properties).join("、");
    throw new Error(`プロパティが見つかりません: ${name}（既存: ${names}）`);
  }

  const [propertyName, property] = found;
  if (property.type === "title") {
    throw new Error("タイトル列は削除できません");
  }

  const updated = await client.dataSources.update({
    data_source_id: dataSource.id,
    properties: {
      [propertyName]: null,
    },
  });
  if (!isFullDataSource(updated)) {
    throw new Error("プロパティ削除の応答が不完全です");
  }
  return {
    removed: true,
    name: propertyName,
    type: property.type,
    databaseTitle: dataSourceTitle(updated),
    url: updated.url,
  };
}
