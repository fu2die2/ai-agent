/**
 * Tool（関数呼び出し）の共通型。
 *
 * エージェントは Gemini の function calling で Tool 名を選び、
 * 実際の実行は src/lib/tools/registry.ts が許可リスト経由で行う。
 * 許可されていない名前は呼べない。
 */
export type ToolName =
  | "searchKnowledge"
  | "answerQuestion"
  | "calculate"
  | "saveMemo"
  | "listNotionPages"
  | "listNotionDatabases"
  | "createNotionPage"
  | "appendNotionPage"
  | "addNotionDatabaseProperty"
  | "removeNotionDatabaseProperty";

export type ToolStatus = "pending" | "running" | "success" | "error";

/** Tool の引数・戻り値に使う JSON 互換の値。 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Gemini に渡す Tool の説明。description がモデルの選択根拠になる。 */
export type ToolDefinition = {
  name: ToolName;
  description: string;
  parameters: {
    type: "object";
    properties: Record<
      string,
      {
        type: string;
        description: string;
      }
    >;
    required: string[];
  };
};

/** Execution Trace とセッション保存用の、1回の Tool 実行記録。 */
export type ToolExecution = {
  id: string;
  name: ToolName | string;
  status: ToolStatus;
  arguments?: Record<string, JsonValue>;
  result?: JsonValue;
  error?: string;
  startedAt: number;
  endedAt?: number;
};

export type ToolHandler = (
  args: Record<string, JsonValue>,
) => Promise<JsonValue>;
