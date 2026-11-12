/**
 * 許可された Tool の一覧と実行入口。
 *
 * Gemini にはここの description だけが見える。
 * 実行は handlers に載っている名前だけ。モデルが知らない名前を呼んでも拒否する。
 */
import { SchemaType, type FunctionDeclaration } from "@google/generative-ai";
import { answerQuestion } from "./answerQuestion";
import { calculate } from "./calculator";
import { saveMemoTool } from "./memo";
import {
  addNotionDatabasePropertyTool,
  appendNotionPageTool,
  createNotionPageTool,
  listNotionDatabasesTool,
  listNotionPagesTool,
  removeNotionDatabasePropertyTool,
} from "./notionPages";
import { searchKnowledge } from "./search";
import type { JsonValue, ToolDefinition, ToolHandler, ToolName } from "@/types/tool";

export const toolDefinitions: ToolDefinition[] = [
  {
    name: "searchKnowledge",
    description:
      "Notionの社内ナレッジを取得・チャンクして検索する。就業規則・売上・資産など。一般雑学には使わない。結果の citation / url は回答の出典リンクに使う。",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "例: 有給休暇の日数、FY2025の売上、現金預金の残高",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "answerQuestion",
    description:
      "単純な事実質問に答える。検索は Gemini に任せる。「何種類」「いつ」「誰」などの一般質問で使う。",
    parameters: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "ユーザーの質問をそのまま渡す。例: ポケモンは何種類いる？",
        },
      },
      required: ["question"],
    },
  },
  {
    name: "calculate",
    description: "四則演算を実行する。合計、差分、比率、平均値の計算に使う。",
    parameters: {
      type: "object",
      properties: {
        expression: {
          type: "string",
          description: "例: (1400-880)/1400*100",
        },
      },
      required: ["expression"],
    },
  },
  {
    name: "saveMemo",
    description: "調査結果や要約をメモとして保存する。ユーザーが保存を依頼したときだけ使う。",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "メモのタイトル" },
        content: { type: "string", description: "保存する本文" },
      },
      required: ["title", "content"],
    },
  },
  {
    name: "listNotionPages",
    description:
      "指定したNotionデータベース内のページ一覧。databaseId を省略すると社内ナレッジ DB。追記前に対象を探すとき使う。",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "タイトルで絞る語。空なら全件" },
        databaseId: { type: "string", description: "データベース ID または URL。省略時は社内ナレッジ" },
      },
      required: [],
    },
  },
  {
    name: "listNotionDatabases",
    description:
      "Integration がアクセスできる Notion データベースの一覧。作成先を社内ナレッジ以外にするとき先に呼ぶ。",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "データベース名で絞る語" },
      },
      required: [],
    },
  },
  {
    name: "createNotionPage",
    description:
      "Notionに新しいページを作り本文を書く。databaseId / databaseTitle で任意のDB、parentPageId で任意の親ページの子として作れる。どちらも無いときは社内ナレッジ DB。",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "ページタイトル" },
        content: { type: "string", description: "本文。Markdown可（見出し・箇条書き・段落）" },
        category: { type: "string", description: "カテゴリ列があれば設定。例: 総務" },
        keywords: { type: "string", description: "キーワード。カンマ区切り" },
        databaseId: { type: "string", description: "作成先データベースの ID または URL" },
        databaseTitle: { type: "string", description: "作成先データベースの名前。IDが無いとき" },
        parentPageId: { type: "string", description: "親ページの ID または URL。指定するとその子ページになる" },
      },
      required: ["title", "content"],
    },
  },
  {
    name: "appendNotionPage",
    description:
      "既存のNotionページ末尾に本文を追記する。pageId（URLでも可）か title のどちらかが必要。",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "追記する本文。Markdown可" },
        pageId: { type: "string", description: "ページIDまたはNotionのURL" },
        title: { type: "string", description: "pageIdが無いときのページタイトル" },
      },
      required: ["content"],
    },
  },
  {
    name: "addNotionDatabaseProperty",
    description:
      "Notionデータベースに列（プロパティ）を追加する。type は rich_text / number / select / multi_select / url / checkbox / date。select は options にカンマ区切り。",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "列名。例: 担当部署" },
        type: { type: "string", description: "列の型。例: select" },
        options: { type: "string", description: "select / multi_select の選択肢。カンマ区切り" },
        databaseId: { type: "string", description: "対象DBの ID または URL。省略時は社内ナレッジ" },
        databaseTitle: { type: "string", description: "対象DBの名前" },
      },
      required: ["name", "type"],
    },
  },
  {
    name: "removeNotionDatabaseProperty",
    description:
      "Notionデータベースから列（プロパティ）を削除する。タイトル列は削除できない。ユーザーが列を消してと依頼したときだけ使う。",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "削除する列名。例: 担当部署" },
        databaseId: { type: "string", description: "対象DBの ID または URL。省略時は社内ナレッジ" },
        databaseTitle: { type: "string", description: "対象DBの名前" },
      },
      required: ["name"],
    },
  },
];

const handlers: Record<ToolName, ToolHandler> = {
  searchKnowledge,
  answerQuestion,
  calculate,
  saveMemo: saveMemoTool,
  listNotionPages: listNotionPagesTool,
  listNotionDatabases: listNotionDatabasesTool,
  createNotionPage: createNotionPageTool,
  appendNotionPage: appendNotionPageTool,
  addNotionDatabaseProperty: addNotionDatabasePropertyTool,
  removeNotionDatabaseProperty: removeNotionDatabasePropertyTool,
};

/** 定義一覧。/api/tools がこれをそのまま返す。 */
export function listTools() {
  return toolDefinitions;
}

/** 名前が許可リストにあれば handler を実行する。それ以外はエラー。 */
export async function executeTool(
  name: string,
  args: Record<string, JsonValue>,
): Promise<JsonValue> {
  const handler = handlers[name as ToolName];
  if (!handler) {
    throw new Error(`許可されていない Tool です: ${name}`);
  }
  return handler(args);
}

/** 自前の ToolDefinition を Gemini SDK の FunctionDeclaration に変換する。 */
export function toGeminiTools(): FunctionDeclaration[] {
  return toolDefinitions.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: {
      type: SchemaType.OBJECT,
      description: tool.description,
      properties: Object.fromEntries(
        Object.entries(tool.parameters.properties).map(([key, value]) => [
          key,
          {
            type: SchemaType.STRING,
            description: value.description,
          },
        ]),
      ),
      required: tool.parameters.required,
    },
  }));
}
