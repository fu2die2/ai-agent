import { SchemaType, type FunctionDeclaration } from "@google/generative-ai";
import { calculate } from "./calculator";
import { saveMemoTool } from "./memo";
import { searchKnowledge } from "./search";
import type { JsonValue, ToolDefinition, ToolHandler, ToolName } from "@/types/tool";

export const toolDefinitions: ToolDefinition[] = [
  {
    name: "searchKnowledge",
    description:
      "社内ナレッジやサンプル統計から関連情報を検索する。事実確認や比較の前に使う。",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "検索クエリ。固有名詞や比較対象を含める。",
        },
      },
      required: ["query"],
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
];

const handlers: Record<ToolName, ToolHandler> = {
  searchKnowledge,
  calculate,
  saveMemo: saveMemoTool,
};

export function listTools() {
  return toolDefinitions;
}

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
