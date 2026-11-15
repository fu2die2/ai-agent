/**
 * Notion への書き込み。
 * 社内ナレッジ DB 以外にも、Integration がアクセスできる DB・親ページへ作れる。
 *
 * 作成は pages.create、追記は blocks.children.append。
 * 本文は Markdown を見出し・箇条書き・段落・コードブロックに落とす。
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
  notionDesignDatabaseId,
  notionPageUrl,
  resolveDataSourceId,
} from "./notion-client";

const MAX_BLOCKS = 400;
const BLOCK_BATCH = 100;
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

type TextMarks = {
  bold: boolean;
  italic: boolean;
  strikethrough: boolean;
  code: boolean;
};

type InlinePiece = TextMarks & {
  content: string;
  href?: string;
};

const PLAIN_MARKS: TextMarks = {
  bold: false,
  italic: false,
  strikethrough: false,
  code: false,
};

/** 次の Markdown 記号の位置。無ければ末尾。 */
function nextInlineMarker(input: string, from: number) {
  let min = input.length;
  for (const marker of ["*", "`", "~", "["]) {
    const at = input.indexOf(marker, from);
    if (at >= 0 && at < min) min = at;
  }
  return min;
}

/** 太字・斜体・打ち消し・インラインコード・リンクを分割する。 */
function parseInlineMarkdown(input: string, inherited: TextMarks = PLAIN_MARKS): InlinePiece[] {
  const pieces: InlinePiece[] = [];
  let i = 0;

  const emit = (content: string, extra: Partial<InlinePiece> = {}) => {
    if (!content) return;
    pieces.push({
      content,
      bold: extra.bold ?? inherited.bold,
      italic: extra.italic ?? inherited.italic,
      strikethrough: extra.strikethrough ?? inherited.strikethrough,
      code: extra.code ?? inherited.code,
      href: extra.href,
    });
  };

  while (i < input.length) {
    if (inherited.code) {
      emit(input.slice(i));
      break;
    }

    const link = input.slice(i).match(/^\[([^\]]+)\]\((https?:[^)\s]+)\)/);
    if (link) {
      const inner = parseInlineMarkdown(link[1], inherited);
      for (const part of inner) {
        pieces.push({ ...part, href: part.href ?? link[2] });
      }
      i += link[0].length;
      continue;
    }

    if (input[i] === "`") {
      const end = input.indexOf("`", i + 1);
      if (end > i) {
        emit(input.slice(i + 1, end), { code: true });
        i = end + 1;
        continue;
      }
    }

    if (input.startsWith("***", i)) {
      const end = input.indexOf("***", i + 3);
      if (end > i) {
        pieces.push(
          ...parseInlineMarkdown(input.slice(i + 3, end), {
            ...inherited,
            bold: true,
            italic: true,
          }),
        );
        i = end + 3;
        continue;
      }
    }

    if (input.startsWith("**", i)) {
      const end = input.indexOf("**", i + 2);
      if (end > i) {
        pieces.push(
          ...parseInlineMarkdown(input.slice(i + 2, end), { ...inherited, bold: true }),
        );
        i = end + 2;
        continue;
      }
    }

    if (input.startsWith("~~", i)) {
      const end = input.indexOf("~~", i + 2);
      if (end > i) {
        pieces.push(
          ...parseInlineMarkdown(input.slice(i + 2, end), {
            ...inherited,
            strikethrough: true,
          }),
        );
        i = end + 2;
        continue;
      }
    }

    if (input[i] === "*" && input[i + 1] !== "*") {
      const end = input.indexOf("*", i + 1);
      if (end > i && input[end + 1] !== "*") {
        pieces.push(
          ...parseInlineMarkdown(input.slice(i + 1, end), { ...inherited, italic: true }),
        );
        i = end + 1;
        continue;
      }
    }

    const next = nextInlineMarker(input, i + 1);
    emit(input.slice(i, next));
    i = next;
  }

  return pieces;
}

type NotionText = {
  type: "text";
  text: { content: string; link?: { url: string } };
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    strikethrough?: boolean;
    code?: boolean;
  };
};

/** ページタイトルなど、Markdown を解釈しない rich_text。 */
function richText(content: string): NotionText[] {
  const text = content.slice(0, MAX_RICH_TEXT * 2);
  if (!text) return [{ type: "text", text: { content: "" } }];
  return richTextChunks(text);
}

/** 見出し・段落・リスト用。**太字** や `コード` を Notion の注釈にする。 */
function styledRichText(content: string): NotionText[] {
  const pieces = parseInlineMarkdown(content);
  if (pieces.length === 0) return [{ type: "text", text: { content: "" } }];
  const items: NotionText[] = [];
  for (const piece of pieces) {
    for (let i = 0; i < piece.content.length; i += MAX_RICH_TEXT) {
      const chunk = piece.content.slice(i, i + MAX_RICH_TEXT);
      const item: NotionText = {
        type: "text",
        text: piece.href ? { content: chunk, link: { url: piece.href } } : { content: chunk },
      };
      if (piece.bold || piece.italic || piece.strikethrough || piece.code) {
        item.annotations = {
          ...(piece.bold ? { bold: true } : {}),
          ...(piece.italic ? { italic: true } : {}),
          ...(piece.strikethrough ? { strikethrough: true } : {}),
          ...(piece.code ? { code: true } : {}),
        };
      }
      items.push(item);
    }
  }
  return items;
}

/** 文字数制限だけ分割する。コードブロックは長めでも切らずに載せる。 */
function richTextChunks(content: string): Array<{ type: "text"; text: { content: string } }> {
  if (!content) return [{ type: "text", text: { content: "" } }];
  const parts: Array<{ type: "text"; text: { content: string } }> = [];
  for (let i = 0; i < content.length; i += MAX_RICH_TEXT) {
    parts.push({ type: "text", text: { content: content.slice(i, i + MAX_RICH_TEXT) } });
  }
  return parts;
}

const NOTION_CODE_LANGUAGES = new Set([
  "abap",
  "abc",
  "agda",
  "arduino",
  "ascii art",
  "assembly",
  "bash",
  "basic",
  "bnf",
  "c",
  "c#",
  "c++",
  "clojure",
  "coffeescript",
  "coq",
  "css",
  "dart",
  "dhall",
  "diff",
  "docker",
  "ebnf",
  "elixir",
  "elm",
  "erlang",
  "f#",
  "flow",
  "fortran",
  "gherkin",
  "glsl",
  "go",
  "graphql",
  "groovy",
  "haskell",
  "hcl",
  "html",
  "idris",
  "java",
  "javascript",
  "json",
  "julia",
  "kotlin",
  "latex",
  "less",
  "lisp",
  "livescript",
  "llvm ir",
  "lua",
  "makefile",
  "markdown",
  "markup",
  "matlab",
  "mathematica",
  "mermaid",
  "nix",
  "notion formula",
  "objective-c",
  "ocaml",
  "pascal",
  "perl",
  "php",
  "plain text",
  "powershell",
  "prolog",
  "protobuf",
  "purescript",
  "python",
  "r",
  "racket",
  "reason",
  "ruby",
  "rust",
  "sass",
  "scala",
  "scheme",
  "scss",
  "shell",
  "smalltalk",
  "solidity",
  "sql",
  "swift",
  "toml",
  "typescript",
  "vb.net",
  "verilog",
  "vhdl",
  "visual basic",
  "webassembly",
  "xml",
  "yaml",
  "java/c/c++/c#",
]);

const CODE_LANGUAGE_ALIASES: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  node: "javascript",
  py: "python",
  sh: "shell",
  zsh: "shell",
  bash: "bash",
  yml: "yaml",
  md: "markdown",
  txt: "plain text",
  text: "plain text",
  plaintext: "plain text",
  env: "shell",
  dotenv: "shell",
};

/** Markdown の言語名を Notion の code.language に合わせる。 */
function notionCodeLanguage(raw: string) {
  const value = raw.trim().toLowerCase();
  if (!value) return "plain text" as const;
  const mapped = CODE_LANGUAGE_ALIASES[value] ?? value;
  if (NOTION_CODE_LANGUAGES.has(mapped)) return mapped;
  return "plain text" as const;
}

/** Markdown を Notion ブロック列にする。コードフェンスは code ブロックにする。 */
export function markdownToBlocks(markdown: string): BlockObjectRequest[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: BlockObjectRequest[] = [];

  /** ブロックを上限まで積む。 */
  const push = (block: BlockObjectRequest) => {
    if (blocks.length < MAX_BLOCKS) blocks.push(block);
  };

  let fence: { language: string; body: string[] } | null = null;

  /** 溜めたフェンスを Notion の code にする。 */
  const flushCode = () => {
    if (!fence) return;
    push({
      code: {
        rich_text: richTextChunks(fence.body.join("\n") || " "),
        language: notionCodeLanguage(fence.language) as "plain text",
      },
    });
    fence = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    const fenceOpen = trimmed.match(/^```+\s*([a-zA-Z0-9/+#._-]*)\s*$/);

    if (fence) {
      if (fenceOpen && !fenceOpen[1]) {
        flushCode();
        continue;
      }
      fence.body.push(raw.replace(/\n$/, ""));
      continue;
    }

    if (fenceOpen) {
      fence = { language: fenceOpen[1] ?? "", body: [] };
      continue;
    }

    if (!trimmed) continue;

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      push({ divider: {} });
      continue;
    }
    if (trimmed.startsWith("### ")) {
      push({ heading_3: { rich_text: styledRichText(trimmed.slice(4)) } });
      continue;
    }
    if (trimmed.startsWith("## ")) {
      push({ heading_2: { rich_text: styledRichText(trimmed.slice(3)) } });
      continue;
    }
    if (trimmed.startsWith("# ")) {
      push({ heading_1: { rich_text: styledRichText(trimmed.slice(2)) } });
      continue;
    }
    const todo = trimmed.match(/^[-*] \[([ xX])\]\s+(.*)$/);
    if (todo) {
      push({
        to_do: {
          rich_text: styledRichText(todo[2]),
          checked: todo[1].toLowerCase() === "x",
        },
      });
      continue;
    }
    if (/^[-*] /.test(trimmed)) {
      push({ bulleted_list_item: { rich_text: styledRichText(trimmed.slice(2)) } });
      continue;
    }
    const numbered = trimmed.match(/^\d+\.\s+(.*)$/);
    if (numbered) {
      push({ numbered_list_item: { rich_text: styledRichText(numbered[1]) } });
      continue;
    }
    if (trimmed.startsWith("> ")) {
      push({ quote: { rich_text: styledRichText(trimmed.slice(2)) } });
      continue;
    }
    push({ paragraph: { rich_text: styledRichText(trimmed) } });
  }

  flushCode();

  if (blocks.length === 0) {
    push({ paragraph: { rich_text: styledRichText(markdown.trim() || " ") } });
  }
  return blocks;
}

/** Notion は1回 100 ブロックまでなので分割して append する。 */
async function appendBlockBatches(
  client: ReturnType<typeof getNotionClient>,
  blockId: string,
  blocks: BlockObjectRequest[],
) {
  for (let i = 0; i < blocks.length; i += BLOCK_BATCH) {
    await client.blocks.children.append({
      block_id: blockId,
      children: blocks.slice(i, i + BLOCK_BATCH),
    });
  }
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
    const found = findSchemaProperty(dataSource, ["カテゴリ", "ジャンル", "category", "genre"]);
    if (found) {
      const [name, config] = found;
      const value = input.category.trim();
      if (config.type === "select" || config.type === "status") {
        properties[name] = { [config.type]: { name: value } };
      } else if (config.type === "multi_select") {
        properties[name] = { multi_select: [{ name: value }] };
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
    const blocks = markdownToBlocks(content);
    const created = await client.pages.create({
      parent: { page_id: parentPageId },
      properties: {
        title: { title: richText(title.slice(0, MAX_RICH_TEXT)) },
      },
      children: blocks.slice(0, BLOCK_BATCH),
    });
    if (!isFullPage(created)) throw new Error("ページ作成の応答が不完全です");
    if (blocks.length > BLOCK_BATCH) {
      await appendBlockBatches(client, created.id, blocks.slice(BLOCK_BATCH));
    }
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

  const blocks = markdownToBlocks(content);
  const created = await client.pages.create({
    parent: { data_source_id: dataSource.id },
    properties: properties as Parameters<typeof client.pages.create>[0]["properties"],
    children: blocks.slice(0, BLOCK_BATCH),
  });
  if (!isFullPage(created)) throw new Error("ページ作成の応答が不完全です");
  if (blocks.length > BLOCK_BATCH) {
    await appendBlockBatches(client, created.id, blocks.slice(BLOCK_BATCH));
  }
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
  await appendBlockBatches(client, pageId, markdownToBlocks(content));
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

export const APP_DESIGN_DOC_TITLE = "MY HERO AGENT 設計書";

/** ページ本文のブロックを全部消してから Markdown を書き直す。 */
export async function replaceNotionPageBody(pageId: string, content: string) {
  const client = getNotionClient();
  const id = normalizePageId(pageId);
  let cursor: string | undefined;
  do {
    const response = await client.blocks.children.list({
      block_id: id,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const block of response.results) {
      await client.blocks.delete({ block_id: block.id });
    }
    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);
  await appendBlockBatches(client, id, markdownToBlocks(content));
}

/** 設計書 DB（無ければ社内ナレッジ）に設計書ページを作るか、既存を本文ごと更新する。 */
export async function upsertAppDesignDoc(content: string) {
  const databaseId = notionDesignDatabaseId() || notionDatabaseId();
  const pages = await listNotionPages(APP_DESIGN_DOC_TITLE, databaseId);
  const existing = pages.find((page) => page.title === APP_DESIGN_DOC_TITLE);
  if (existing) {
    await replaceNotionPageBody(existing.id, content);
    return { ...existing, updated: true as const, created: false as const };
  }
  const created = await createNotionPage({
    title: APP_DESIGN_DOC_TITLE,
    content,
    category: "開発",
    keywords: "設計,RAG,アーキテクチャ,MY HERO AGENT,ER,フロー",
    databaseId,
  });
  return { ...created, updated: false as const, created: true as const };
}
