import { SchemaType, type FunctionDeclaration } from "@google/generative-ai";
import { answerQuestion } from "./answerQuestion";
import { calculate } from "./calculator";
import { saveMemoTool } from "./memo";
import { searchKnowledge } from "./search";
import type { JsonValue, ToolDefinition, ToolHandler, ToolName } from "@/types/tool";

export const toolDefinitions: ToolDefinition[] = [
  {
    name: "searchKnowledge",
    description:
      "Notionの社内ナレッジを取得・チャンクして検索する。就業規則・売上・資産など。一般雑学には使わない。",
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
];

const handlers: Record<ToolName, ToolHandler> = {
  searchKnowledge,
  answerQuestion,
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
