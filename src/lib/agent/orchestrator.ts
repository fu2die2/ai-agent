/**
 * エージェントの中核。
 *
 * 流れ:
 * 1. ユーザー発言をセッションに積む
 * 2. Gemini が Tool を選ぶ（キーが無いときは正規表現のデモプラン）
 * 3. 許可された Tool だけ実行し、結果をモデルに戻す（最大 MAX_TOOL_ROUNDS 回）
 * 4. Verifier が回答を点検し、不合格なら一度だけ書き直す
 * 5. SSE で画面の Execution Trace を更新する
 */
import type { Content, FunctionCall } from "@google/generative-ai";
import {
  generateAgentTurn,
  generateText,
  hasGeminiKey,
  isQuotaError,
} from "@/lib/ai/client";
import { verifyResult } from "@/lib/agent/verifier";
import { executeTool, toGeminiTools } from "@/lib/tools/registry";
import { getSession, saveSession } from "@/lib/store/db";
import type {
  AgentEvent,
  ChatMessage,
  SessionRecord,
  TraceStep,
  VerificationResult,
} from "@/types/agent";
import type { JsonValue, ToolExecution } from "@/types/tool";

const MAX_TOOL_ROUNDS = 5;

const AGENT_INSTRUCTIONS = `あなたはAIエージェントです。
ユーザーの依頼を達成してください。
必要に応じて利用可能なToolを実行してください。
searchKnowledge の結果は Notion から取得した社内文書の抜粋です。その抜粋だけを根拠に答え、出典を残してください。
抜粋に無い数値や規定は補完せず、不足を明示してください。
最終回答は日本語で、要点が分かるように書いてください。

Toolの使い分け:
- searchKnowledge: Notionの社内ナレッジ（就業規則・売上・資産・福利厚生など）。一般雑学には使わない。
- answerQuestion: 一般的な事実質問。検索は Gemini に任せる。
- calculate: 計算が必要なとき。
- saveMemo: ユーザーが保存を依頼したときだけ。`;

type Emit = (event: AgentEvent) => void;

/** Trace / メッセージ / Tool 実行の ID を作る。 */
function id(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/** サイドバー用の短い会話タイトル。先頭24文字。 */
function titleFromMessage(message: string) {
  const trimmed = message.replace(/\s+/g, " ").trim();
  return trimmed.length > 24 ? `${trimmed.slice(0, 24)}…` : trimmed || "新しい会話";
}

/** Gemini の functionCall.args を自前の JSON オブジェクトに揃える。 */
function asArgs(value: unknown): Record<string, JsonValue> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, JsonValue>;
  }
  return {};
}

/** GEMINI_API_KEY が無いときに、キーワードだけで Tool を選ぶ。 */
function demoPlan(message: string) {
  const calls: { name: string; args: Record<string, JsonValue> }[] = [];
  if (
    /調べ|比較|就業|有給|休暇|リモート|給与|売上|資産|貸借|福利|経費|ヘリオス|社内/.test(
      message,
    )
  ) {
    calls.push({ name: "searchKnowledge", args: { query: message } });
  }
  if (/何種類|いつ|誰|どこ|とは|教えて|ポケモン|pokemon/i.test(message)) {
    calls.push({ name: "answerQuestion", args: { question: message } });
  }
  if (/計算|合計|平均|差分|比率|%/.test(message) || /人口/.test(message)) {
    if (/東京/.test(message) && /大阪/.test(message)) {
      calls.push({
        name: "calculate",
        args: { expression: "(14000000-8800000)/14000000*100" },
      });
    }
  }
  if (/保存|メモ/.test(message)) {
    calls.push({
      name: "saveMemo",
      args: {
        title: titleFromMessage(message),
        content: "エージェントがまとめた調査メモ（デモモード）",
      },
    });
  }
  if (calls.length === 0) {
    calls.push({ name: "answerQuestion", args: { question: message } });
  }
  return calls;
}

/** デモモードの最終文面。Tool の JSON を人が読める文章に並べる。 */
function demoAnswer(message: string, toolResults: JsonValue[]) {
  const lines = [
    "デモモードで処理しました。`.env.local` に GEMINI_API_KEY を入れると、Gemini が Tool を自律選択します。",
    "",
  ];
  for (const result of toolResults) {
    if (result && typeof result === "object" && "answers" in result) {
        const answers = (
        result as {
          answers: {
            title: string;
            content: string;
            source: string;
            url?: string;
            urls?: string[];
          }[];
        }
      ).answers;
      if (answers.length === 0) {
        lines.push("公開情報: 該当なし");
      } else {
        for (const answer of answers) {
          lines.push(`【${answer.title}】(${answer.source})`);
          lines.push(answer.content);
          if (answer.url) lines.push(answer.url);
          if (answer.urls?.length) lines.push(answer.urls.join("\n"));
          lines.push("");
        }
      }
    }
    if (result && typeof result === "object" && "results" in result) {
      const docs = (
        result as {
          results: { title: string; content: string; source: string; score?: number }[];
        }
      ).results;
      if (docs.length === 0) {
        lines.push("検索: 一致するナレッジはありませんでした。");
      } else {
        for (const doc of docs) {
          lines.push(`【${doc.title}】(${doc.source})`);
          lines.push(doc.content);
          if ("score" in doc && typeof doc.score === "number") {
            lines.push(`関連度: ${doc.score}`);
          }
          lines.push("");
        }
      }
    }
    if (result && typeof result === "object" && "result" in result) {
      const calc = result as { expression: string; result: number };
      lines.push(`計算: ${calc.expression} = ${calc.result}`);
      lines.push("");
    }
    if (result && typeof result === "object" && "saved" in result) {
      const memo = result as { title: string; saved: boolean };
      lines.push(`メモ保存: ${memo.saved ? "成功" : "失敗"} / ${memo.title}`);
    }
  }
  lines.push("", `依頼: ${message}`);
  return lines.join("\n");
}

/** 既存セッションを読む。無ければ空の会話を作る（まだファイルには書かない）。 */
async function ensureSession(sessionId: string, message: string): Promise<SessionRecord> {
  const existing = await getSession(sessionId);
  if (existing) return existing;
  return {
    id: sessionId,
    title: titleFromMessage(message),
    updatedAt: Date.now(),
    messages: [],
    traces: [],
    toolExecutions: [],
  };
}

/** 1つの Tool を実行し、Trace と SSE を同時に更新する。 */
async function runOneTool(options: {
  toolId: string;
  name: string;
  args: Record<string, JsonValue>;
  emit: Emit;
  traces: TraceStep[];
  executions: ToolExecution[];
  toolResults: JsonValue[];
}) {
  const { toolId, name, args, emit, traces, executions, toolResults } = options;
  emit({ type: "tool.started", data: { id: toolId, name, arguments: args } });
  const execution: ToolExecution = {
    id: toolId,
    name,
    status: "running",
    arguments: args,
    startedAt: Date.now(),
  };
  executions.push(execution);
  traces.push({
    id: id("trace"),
    kind: "tool",
    title: name,
    toolName: name,
    status: "running",
    detail: "実行中",
  });

  try {
    const result = await executeTool(name, args);
    execution.status = "success";
    execution.result = result;
    execution.endedAt = Date.now();
    toolResults.push(result);
    traces[traces.length - 1].status = "completed";
    traces[traces.length - 1].detail = "Success";
    emit({
      type: "tool.completed",
      data: { id: toolId, name, status: "success", result },
    });
    return { ok: true as const, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tool 実行に失敗しました";
    execution.status = "error";
    execution.error = message;
    execution.endedAt = Date.now();
    traces[traces.length - 1].status = "failed";
    traces[traces.length - 1].detail = message;
    emit({
      type: "tool.completed",
      data: { id: toolId, name, status: "error", error: message },
    });
    return { ok: false as const, error: message };
  }
}

/** 画面の role=assistant は Gemini では role=model。 */
function toGeminiHistory(messages: ChatMessage[]): Content[] {
  return messages.map((item) => ({
    role: item.role === "assistant" ? "model" : "user",
    parts: [{ text: item.content }],
  }));
}

/** 1回のユーザー発言を最後まで処理する入口。emit で SSE に途中経過を流す。 */
export async function runAgent(options: {
  sessionId: string;
  message: string;
  emit: Emit;
}) {
  const started = Date.now();
  const { emit } = options;
  const sessionId = options.sessionId || id("session");
  const userMessage: ChatMessage = {
    id: id("msg"),
    role: "user",
    content: options.message,
    createdAt: Date.now(),
  };

  emit({ type: "agent.started", data: { status: "running", sessionId } });
  emit({
    type: "agent.planning",
    data: { status: "running", detail: "依頼を分解し、必要な Tool を判断します" },
  });

  const session = await ensureSession(sessionId, options.message);
  session.messages.push(userMessage);
  session.traces = [];
  session.toolExecutions = [];

  const traces: TraceStep[] = [
    {
      id: id("trace"),
      kind: "planning",
      title: "Agent Planning",
      detail: "依頼を分析して実行計画を立てています",
      status: "running",
    },
  ];
  const executions: ToolExecution[] = [];
  const toolResults: JsonValue[] = [];

  try {
    let answer = "";

    // キー無しはデモ。あっても Gemini が functionCall を出すまでループする
    if (!hasGeminiKey()) {
      const calls = demoPlan(options.message);
      traces[0].status = "completed";
      traces[0].detail = "デモプランナーが Tool を選択しました";
      emit({
        type: "agent.planning",
        data: { status: "completed", detail: traces[0].detail },
      });

      for (const call of calls) {
        await runOneTool({
          toolId: id("tool"),
          name: call.name,
          args: call.args,
          emit,
          traces,
          executions,
          toolResults,
        });
      }
      answer = demoAnswer(options.message, toolResults);
    } else {
      const contents = toGeminiHistory(session.messages);
      let rounds = 0;
      let finished = false;

      while (rounds < MAX_TOOL_ROUNDS && !finished) {
        rounds += 1;
        const turn = await generateAgentTurn({
          systemInstruction: AGENT_INSTRUCTIONS,
          tools: toGeminiTools(),
          contents,
        });

        if (rounds === 1) {
          traces[0].status = "completed";
          traces[0].detail = turn.functionCalls.length
            ? "必要な Tool を選択しました"
            : "Tool なしで回答します";
          emit({
            type: "agent.planning",
            data: { status: "completed", detail: traces[0].detail },
          });
        }

        // Tool 要求がある間は、モデルの functionCall を会話に残し、結果を user 役で返す
        if (turn.functionCalls.length > 0) {
          contents.push(
            turn.modelContent ?? {
              role: "model",
              parts: turn.functionCalls.map((call: FunctionCall) => ({
                functionCall: call,
              })),
            },
          );

          const responseParts = [];
          for (const call of turn.functionCalls) {
            const args = asArgs(call.args);
            const toolId = id("tool");
            const ran = await runOneTool({
              toolId,
              name: call.name,
              args,
              emit,
              traces,
              executions,
              toolResults,
            });
            const callId = "id" in call && typeof call.id === "string" ? call.id : call.name;
            responseParts.push({
              functionResponse: {
                id: callId,
                name: call.name,
                response: ran.ok ? { result: ran.result } : { error: ran.error },
              },
            });
          }
          contents.push({
            role: "user",
            parts: responseParts,
          });
          continue;
        }

        answer = turn.text;
        finished = true;
      }

      if (!answer) {
        answer = "Tool 実行の上限に達したため、ここまでの結果をもとに回答します。";
      }
    }

    emit({ type: "verification.started", data: { status: "running" } });
    traces.push({
      id: id("trace"),
      kind: "verification",
      title: "Result Verifier",
      status: "running",
      detail: "回答と Tool 結果を照合しています",
    });

    let verification: VerificationResult = await verifyResult({
      userRequest: options.message,
      toolResults,
      finalAnswer: answer,
    });

    // 不合格なら指摘を渡してもう一度生成し、再検証する（クォータ不足なら現状のまま返す）
    if (verification.status === "failed" && hasGeminiKey()) {
      try {
        answer = await generateText(
          `元の依頼:\n${options.message}\n\n現在の回答:\n${answer}\n\n検証で指摘された問題:\n${verification.issues.join("\n")}\n\n指摘を解消した最終回答だけを返してください。`,
          AGENT_INSTRUCTIONS,
        );
        verification = await verifyResult({
          userRequest: options.message,
          toolResults,
          finalAnswer: answer,
        });
      } catch (error) {
        if (!isQuotaError(error)) {
          throw error;
        }
      }
    }

    traces[traces.length - 1].status =
      verification.status === "passed" ? "passed" : "failed";
    traces[traces.length - 1].detail = verification.summary;
    emit({ type: "verification.completed", data: verification });

    traces.push({
      id: id("trace"),
      kind: "response",
      title: "Final Response",
      status: "completed",
      detail: "分析結果をユーザーに返却",
    });

    const assistantMessage: ChatMessage = {
      id: id("msg"),
      role: "assistant",
      content: answer,
      createdAt: Date.now(),
    };
    session.messages.push(assistantMessage);
    session.traces = traces;
    session.toolExecutions = executions;
    session.lastAnswer = answer;
    session.verification = verification;
    session.updatedAt = Date.now();
    if (session.messages.filter((item) => item.role === "user").length === 1) {
      session.title = titleFromMessage(options.message);
    }
    await saveSession(session);

    emit({ type: "agent.delta", data: { content: answer } });
    emit({
      type: "agent.completed",
      data: {
        status: "completed",
        answer,
        verification,
        summary: {
          toolCalls: executions.length,
          durationMs: Date.now() - started,
        },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "エージェント実行に失敗しました";
    emit({ type: "agent.error", data: { message } });
  }
}
