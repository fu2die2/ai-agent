import { generateJson, hasGeminiKey } from "@/lib/ai/client";
import type { VerificationResult } from "@/types/agent";
import type { JsonValue } from "@/types/tool";

const SYSTEM = `あなたはAIエージェントの出力を検証する関数です。
次をチェックし、JSONだけを返してください。
- ユーザー依頼を満たしているか
- 数値に矛盾がないか
- 出典と回答が一致しているか
- 保存依頼がある場合、保存が実行されているか
- 不明な情報を断定していないか

出力形式:
{"status":"passed"|"failed","issues":["..."],"summary":"..."}`;

function heuristicVerify(params: {
  userRequest: string;
  toolResults: JsonValue[];
  finalAnswer: string;
}): VerificationResult {
  const issues: string[] = [];
  const request = params.userRequest;
  const answer = params.finalAnswer;

  if (!answer.trim()) {
    issues.push("最終回答が空です");
  }
  if (/保存|メモ/.test(request) && !JSON.stringify(params.toolResults).includes("saved")) {
    issues.push("保存依頼があるのに saveMemo の成功結果がありません");
  }
  if (/調べ|比較|就業|有給|売上|資産/.test(request) && params.toolResults.length === 0) {
    issues.push("調査依頼なのに Tool 結果がありません");
  }

  return {
    status: issues.length ? "failed" : "passed",
    issues,
    summary: issues.length
      ? "検証で問題が見つかりました"
      : "依頼内容と Tool 結果、最終回答に大きな矛盾はありません",
  };
}

export async function verifyResult(params: {
  userRequest: string;
  toolResults: JsonValue[];
  finalAnswer: string;
}): Promise<VerificationResult> {
  if (!hasGeminiKey()) {
    return heuristicVerify(params);
  }

  try {
    const raw = await generateJson(JSON.stringify(params, null, 2), SYSTEM);
    const parsed = JSON.parse(raw) as VerificationResult;
    return {
      status: parsed.status === "failed" ? "failed" : "passed",
      issues: Array.isArray(parsed.issues) ? parsed.issues.map(String) : [],
      summary: parsed.summary || "検証完了",
    };
  } catch {
    return heuristicVerify(params);
  }
}
