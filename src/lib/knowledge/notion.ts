/**
 * Notion を正本としてページ本文を取る。
 *
 * 新しい Notion API では「データベース」の中に data source があり、
 * 行の一覧は databases.query ではなく dataSources.query。
 * 本文はページ ID に対する blocks.children（入れ子ブロックは再帰）。
 *
 * 必要な環境変数: NOTION_TOKEN, NOTION_DATABASE_ID
 * トークンを入れたあとは開発サーバーの再起動が必要。
 */
import {
  Client,
  collectPaginatedAPI,
  isFullBlock,
  isFullPage,
  type BlockObjectResponse,
  type PageObjectResponse,
  type RichTextItemResponse,
} from "@notionhq/client";
import { getNotionClient, notionPageUrl, resolveDataSourceId } from "./notion-client";
import type { KnowledgeDoc } from "./types";

/** rich_text 配列をプレーン文字列に連結する。 */
function richText(items: RichTextItemResponse[] | undefined) {
  return (items ?? []).map((item) => item.plain_text).join("");
}

/** タイトル・セレクト・リッチテキストなど、型の違うプロパティを文字列にする。 */
function propertyText(property: PageObjectResponse["properties"][string] | undefined) {
  if (!property) return "";
  switch (property.type) {
    case "title":
      return richText(property.title);
    case "rich_text":
      return richText(property.rich_text);
    case "select":
      return property.select?.name ?? "";
    case "multi_select":
      return property.multi_select.map((item) => item.name).join(", ");
    case "url":
      return property.url ?? "";
    case "number":
      return property.number == null ? "" : String(property.number);
    case "status":
      return property.status?.name ?? "";
    default:
      return "";
  }
}

/** プロパティ名の候補（日本語・英語）から最初に当たった列を返す。 */
function findProperty(
  properties: PageObjectResponse["properties"],
  candidates: string[],
) {
  const entries = Object.entries(properties);
  for (const name of candidates) {
    const exact = entries.find(([key]) => key === name);
    if (exact) return exact[1];
  }
  const lowered = candidates.map((name) => name.toLowerCase());
  const fuzzy = entries.find(([key]) =>
    lowered.some((name) => key.toLowerCase().includes(name)),
  );
  return fuzzy?.[1];
}

/** ページタイトル。title 型の列を優先し、無ければ「ページ名」など。 */
export function titleOf(page: PageObjectResponse) {
  const titled = Object.values(page.properties).find((property) => property.type === "title");
  const fromTitle = propertyText(titled);
  if (fromTitle.trim()) return fromTitle.trim();
  return propertyText(findProperty(page.properties, ["ページ名", "名前", "Name", "title"])) || "無題";
}

/** カンマ区切りのキーワード文字列を配列にする。 */
function keywordsOf(value: string) {
  return value
    .split(/[,、]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** ブロック種別ごとの内側オブジェクトから rich_text を取り出す。 */
function blockRichText(block: BlockObjectResponse): RichTextItemResponse[] {
  const inner = block[block.type as keyof BlockObjectResponse];
  if (inner && typeof inner === "object" && "rich_text" in inner) {
    return (inner as { rich_text: RichTextItemResponse[] }).rich_text ?? [];
  }
  return [];
}

/** 子ブロックを全ページ分取る（100件超えてもカーソルで続ける）。 */
async function listChildBlocks(client: Client, blockId: string) {
  return collectPaginatedAPI(client.blocks.children.list, { block_id: blockId });
}

/** Notion ブロックをプレーンテキストへ。表は「セル / セル」の箇条書きにする。 */
async function blocksToText(client: Client, parentId: string): Promise<string> {
  const blocks = await listChildBlocks(client, parentId);
  const lines: string[] = [];

  for (const item of blocks) {
    if (!isFullBlock(item) || item.in_trash) continue;
    const text = richText(blockRichText(item)).trim();

    switch (item.type) {
      case "heading_1":
      case "heading_2":
      case "heading_3":
        if (text) lines.push(text, "");
        break;
      case "paragraph":
      case "quote":
      case "callout":
        if (text) lines.push(text, "");
        break;
      case "bulleted_list_item":
      case "numbered_list_item":
      case "to_do":
        if (text) lines.push(`- ${text}`);
        if (item.has_children) {
          const nested = await blocksToText(client, item.id);
          if (nested) lines.push(nested);
        }
        break;
      case "code":
        if (text) lines.push(text, "");
        break;
      case "table": {
        const rows = await listChildBlocks(client, item.id);
        for (const row of rows) {
          if (!isFullBlock(row) || row.type !== "table_row") continue;
          const cells = row.table_row.cells.map((cell) => richText(cell).trim()).filter(Boolean);
          if (cells.length) lines.push(`- ${cells.join(" / ")}`);
        }
        lines.push("");
        break;
      }
      case "column_list":
      case "column":
      case "toggle":
      case "synced_block": {
        if (text) lines.push(text);
        if (item.has_children) {
          const nested = await blocksToText(client, item.id);
          if (nested) lines.push(nested, "");
        }
        break;
      }
      case "divider":
        lines.push("");
        break;
      default:
        if (text) lines.push(text, "");
        if (item.has_children && item.type !== "child_page" && item.type !== "child_database") {
          const nested = await blocksToText(client, item.id);
          if (nested) lines.push(nested, "");
        }
    }
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** 対象 DB の全ページを KnowledgeDoc にする。本文が空でもプロパティがあれば残す。 */
export async function fetchNotionDocs(): Promise<KnowledgeDoc[]> {
  const client = getNotionClient();
  const dataSourceId = await resolveDataSourceId(client);
  const docs: KnowledgeDoc[] = [];
  let cursor: string | undefined;

  do {
    const response = await client.dataSources.query({
      data_source_id: dataSourceId,
      start_cursor: cursor,
      page_size: 100,
    });

    for (const item of response.results) {
      if (!isFullPage(item) || item.in_trash) continue;
      const body = await blocksToText(client, item.id);
      const extras = Object.entries(item.properties)
        .filter(([, property]) => property.type !== "title")
        .map(([name, property]) => {
          const value = propertyText(property);
          return value ? `${name}：${value}` : "";
        })
        .filter(Boolean)
        .join("\n");
      const content = [extras, body].filter(Boolean).join("\n\n");
      if (!content) continue;
      docs.push({
        id: item.id,
        title: titleOf(item),
        category: propertyText(findProperty(item.properties, ["カテゴリ", "category"])),
        source: propertyText(findProperty(item.properties, ["出典", "source"])) || item.url,
        url: notionPageUrl(item.id, item.url),
        keywords: keywordsOf(propertyText(findProperty(item.properties, ["キーワード", "keywords", "tags"]))),
        content,
        lastEditedTime: item.last_edited_time,
      });
    }

    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return docs;
}

/** ページ ID と更新時刻だけを並べた署名。中身の再取得なしで「変わったか」を見る。 */
export function notionCorpusHash(docs: KnowledgeDoc[]) {
  const signature = docs
    .map((doc) => `${doc.id}:${doc.lastEditedTime}:${doc.url}`)
    .sort()
    .join("|");
  return signature;
}
