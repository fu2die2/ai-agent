/**
 * calculate Tool。
 * LLM に計算させず、サーバーで数式を評価して数値の食い違いを防ぐ。
 */
import type { JsonValue } from "@/types/tool";

/** 許可文字だけの数式を評価し、{ expression, result } を返す。 */
export async function calculate(
  args: Record<string, JsonValue>,
): Promise<JsonValue> {
  const expression = String(args.expression ?? "").trim();
  if (!expression) {
    throw new Error("expression が空です");
  }
  // 四則演算以外（関数呼び出しなど）は入れさせない
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
