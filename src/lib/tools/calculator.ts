import type { JsonValue } from "@/types/tool";

export async function calculate(
  args: Record<string, JsonValue>,
): Promise<JsonValue> {
  const expression = String(args.expression ?? "").trim();
  if (!expression) {
    throw new Error("expression が空です");
  }
  if (!/^[\d+\-*/().%\s]+$/.test(expression)) {
    throw new Error("数式に許可されていない文字が含まれています");
  }

  const result = Function(`"use strict"; return (${expression});`)() as unknown;
  if (typeof result !== "number" || !Number.isFinite(result)) {
    throw new Error("計算結果が数値ではありません");
  }

  return {
    expression,
    result,
  };
}
