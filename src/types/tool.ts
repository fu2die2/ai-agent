export type ToolName = "searchKnowledge" | "calculate" | "saveMemo";

export type ToolStatus = "pending" | "running" | "success" | "error";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

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
