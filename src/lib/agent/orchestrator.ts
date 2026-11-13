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
import type { Content } from "@google/generative-ai";
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
  IoRecord,
  RunIoLog,
  SessionRecord,
  TraceStep,
  VerificationResult,
} from "@/types/agent";
import type { JsonValue, ToolExecution } from "@/types/tool";

const MAX_TOOL_ROUNDS = 10;

const AGENT_INSTRUCTIONS = `あなたはAIエージェントです。
ユーザーの依頼を達成してください。
必要に応じて利用可能なToolを実行してください。
searchKnowledge の結果は Notion から取得した社内文書の抜粋です。その抜粋だけを根拠に答え、出典を残してください。
出典は本文末尾に Markdown リンクで付けてください。各結果の citation（または title と url）を使い、同じページは1つにまとめてください。
例:
出典:
- [就業規則](https://www.notion.so/...)
抜粋に無い数値や規定は補完せず、不足を明示してください。
最終回答は日本語で、要点が分かるように書いてください。

Toolの使い分け:
- searchKnowledge: Notionの社内ナレッジ（就業規則・売上・資産・福利厚生など）。一般雑学には使わない。読み取り専用。
- listNotionDatabases: Integrationが見えるNotionデータベース一覧。社内ナレッジ以外へ書くとき先に使う。
- listNotionPages: Notionのページ一覧。databaseId を渡せばそのDB。追記先を探すとき。
- createNotionPage: Notionに新しいページを作って本文を書く。databaseId / databaseTitle / parentPageId で作成先を指定できる。省略時だけ社内ナレッジDB。コード解説は Markdown のコードフェンス（言語名付きの三重バッククォート）で囲む。
- appendNotionPage: 既存Notionページの末尾に追記する。pageId（URL可）があればどのページでもよい。コードもコードフェンスで書く。
- addNotionDatabaseProperty: Notionデータベースに列を追加する。ユーザーがプロパティを足してと依頼したとき。
- removeNotionDatabaseProperty: Notionデータベースから列を削除する。ユーザーがプロパティを消してと依頼したとき。タイトル列は消せない。
- answerQuestion: 一般的な事実質問。検索は Gemini に任せる。
- calculate: 計算が必要なとき。
- saveMemo: アプリ内メモ。Notionへ書いてとは違う。

Notionに書いたあとは、作成・追記結果の url を Markdown リンクで返してください。`;

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
  if (/Notion.*(作|書|追記|追加)|ページを作|ページを追加/.test(message)) {
    if (/追記|書き足/.test(message)) {
      calls.push({
        name: "appendNotionPage",
        args: {
          title: titleFromMessage(message),
          content: "デモモードの追記です。GEMINI_API_KEY があると本文を書けます。",
        },
      });
    } else {
      calls.push({
        name: "createNotionPage",
        args: {
          title: titleFromMessage(message),
          content: "デモモードの新規ページです。GEMINI_API_KEY があると本文を書けます。",
        },
      });
    }
  } else if (/保存|メモ/.test(message)) {
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
          results: {
            title: string;
            content: string;
            source: string;
            url?: string;
            citation?: string;
            score?: number;
          }[];
        }
      ).results;
      if (docs.length === 0) {
        lines.push("検索: 一致するナレッジはありませんでした。");
      } else {
        for (const doc of docs) {
          lines.push(doc.citation ?? `【${doc.title}】(${doc.url || doc.source})`);
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
      const saved = result as {
        title: string;
        saved: boolean;
        url?: string;
        created?: boolean;
        appended?: boolean;
      };
      if (saved.created) {
        lines.push(`Notionページ作成: ${saved.title}`);
      } else if (saved.appended) {
        lines.push(`Notion追記: ${saved.title}`);
      } else {
        lines.push(`メモ保存: ${saved.saved ? "成功" : "失敗"} / ${saved.title}`);
      }
      if (saved.url) lines.push(saved.url);
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
    ioLogs: [],
  };
}

/** ログ用に JSON 化できる形へ落とす。循環参照などは文字列にする。 */
function toJsonValue(value: unknown): JsonValue {
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch {
    return String(value);
  }
}

/** 1つの Tool を実行し、Trace と SSE を同時に更新する。 */
async function runOneTool(options: {
  toolId: string;
  name: string;
  args: Record<string, JsonValue>;
  emit: Emit;
  log: (record: Omit<IoRecord, "id" | "at">) => void;
  traces: TraceStep[];
  executions: ToolExecution[];
  toolResults: JsonValue[];
}) {
  const { toolId, name, args, emit, log, traces, executions, toolResults } = options;
  log({
    channel: "tool",
    direction: "in",
    label: `${name} へ渡した引数`,
    payload: { toolId, name, arguments: args },
  });
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
    log({
      channel: "tool",
      direction: "out",
      label: `${name} からの戻り値`,
      payload: { toolId, name, status: "success", result },
    });
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
    log({
      channel: "tool",
      direction: "out",
      label: `${name} のエラー`,
      payload: { toolId, name, status: "error", error: message },
    });
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
  const eventLog: { at: number; type: AgentEvent["type"]; data: JsonValue }[] = [];
  const exchanges: IoRecord[] = [];
  const log = (record: Omit<IoRecord, "id" | "at">) => {
    exchanges.push({
      id: id("io"),
      at: Date.now(),
      ...record,
    });
  };
  /** 画面へ流しつつ、データログ用に同じイベントを残す。 */
  const emit: Emit = (event) => {
    eventLog.push({
      at: Date.now(),
      type: event.type,
      data: event.data as JsonValue,
    });
    options.emit(event);
  };
  const sessionId = options.sessionId || id("session");
  const userMessage: ChatMessage = {
    id: id("msg"),
    role: "user",
    content: options.message,
    createdAt: Date.now(),
  };

  log({
    channel: "user",
    direction: "in",
    label: "ユーザー入力",
    payload: { sessionId, content: options.message },
  });
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
  const geminiTools = toGeminiTools();

  /** 失敗時も含め、この発言の入出力を会話に残す。 */
  async function persistIo(answer?: string, verification?: VerificationResult) {
    const runLog: RunIoLog = {
      id: id("run"),
      startedAt: started,
      endedAt: Date.now(),
      userMessage: options.message,
      exchanges,
    };
    session.traces = traces;
    session.toolExecutions = executions;
    session.eventLog = eventLog;
    session.ioLogs = [...(session.ioLogs ?? []), runLog];
    if (answer !== undefined) session.lastAnswer = answer;
    if (verification) session.verification = verification;
    session.updatedAt = Date.now();
    if (session.messages.filter((item) => item.role === "user").length === 1) {
      session.title = titleFromMessage(options.message);
    }
    await saveSession(session);
  }

  try {
    let answer = "";

    // キー無しはデモ。あっても Gemini が functionCall を出すまでループする
    if (!hasGeminiKey()) {
      const calls = demoPlan(options.message);
      traces[0].status = "completed";
      traces[0].detail = "デモプランナーが Tool を選択しました";
      log({
        channel: "gemini",
        direction: "out",
        label: "デモプランナーの Tool 選択",
        payload: { functionCalls: calls },
      });
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
          log,
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
        log({
          channel: "gemini",
          direction: "in",
          label: `Gemini へ送った内容（${rounds}ラウンド目）`,
          payload: toJsonValue({
            round: rounds,
            systemInstruction: AGENT_INSTRUCTIONS,
            tools: geminiTools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            })),
            contents,
          }),
        });
        const turn = await generateAgentTurn({
          systemInstruction: AGENT_INSTRUCTIONS,
          tools: geminiTools,
          contents,
        });
        const selected = turn.functionCalls.map((call) => ({
          id: "id" in call && typeof call.id === "string" ? call.id : undefined,
          name: call.name,
          args: asArgs(call.args),
        }));
        log({
          channel: "gemini",
          direction: "out",
          label: selected.length
            ? `Gemini の Tool 選択（${selected.map((item) => item.name).join(", ")}）`
            : "Gemini のテキスト回答",
          payload: toJsonValue({
            round: rounds,
            model: turn.modelName,
            functionCalls: selected,
            text: turn.text || null,
            modelContent: turn.modelContent ?? null,
          }),
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

        // Tool 要求がある間は、署名付きの model content を会話に残し、結果を user 役で返す
        if (turn.functionCalls.length > 0) {
          contents.push(turn.modelContent);

          const responseParts = [];
          for (const call of turn.functionCalls) {
            const args = asArgs(call.args);
            const toolId = id("tool");
            const ran = await runOneTool({
              toolId,
              name: call.name,
              args,
              emit,
              log,
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
          log({
            channel: "gemini",
            direction: "in",
            label: "Tool 結果を Gemini へ返した内容",
            payload: toJsonValue(responseParts),
          });
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

    const verifierInput = {
      userRequest: options.message,
      toolResults,
      finalAnswer: answer,
    };
    log({
      channel: "verifier",
      direction: "in",
      label: "Verifier へ渡した内容",
      payload: toJsonValue(verifierInput),
    });
    let verification: VerificationResult = await verifyResult(verifierInput);
    log({
      channel: "verifier",
      direction: "out",
      label: `Verifier の判定（${verification.status}）`,
      payload: toJsonValue(verification),
    });

    // 不合格なら指摘を渡してもう一度生成し、再検証する（クォータ不足なら現状のまま返す）
    if (verification.status === "failed" && hasGeminiKey()) {
      try {
        const rewritePrompt = `元の依頼:\n${options.message}\n\n現在の回答:\n${answer}\n\n検証で指摘された問題:\n${verification.issues.join("\n")}\n\n指摘を解消した最終回答だけを返してください。`;
        log({
          channel: "gemini",
          direction: "in",
          label: "Verifier 不合格後の書き直し依頼",
          payload: { prompt: rewritePrompt },
        });
        answer = await generateText(rewritePrompt, AGENT_INSTRUCTIONS);
        log({
          channel: "gemini",
          direction: "out",
          label: "書き直し後の回答",
          payload: { text: answer },
        });
        const retryInput = {
          userRequest: options.message,
          toolResults,
          finalAnswer: answer,
        };
        log({
          channel: "verifier",
          direction: "in",
          label: "再検証へ渡した内容",
          payload: toJsonValue(retryInput),
        });
        verification = await verifyResult(retryInput);
        log({
          channel: "verifier",
          direction: "out",
          label: `再検証の判定（${verification.status}）`,
          payload: toJsonValue(verification),
        });
      } catch (error) {
        if (!isQuotaError(error)) {
          throw error;
        }
        log({
          channel: "gemini",
          direction: "out",
          label: "書き直しをスキップ（クォータ）",
          payload: { error: error instanceof Error ? error.message : String(error) },
        });
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

    log({
      channel: "assistant",
      direction: "out",
      label: "最終回答",
      payload: { content: answer, verification },
    });

    const assistantMessage: ChatMessage = {
      id: id("msg"),
      role: "assistant",
      content: answer,
      createdAt: Date.now(),
    };
    session.messages.push(assistantMessage);
    await persistIo(answer, verification);

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
    log({
      channel: "assistant",
      direction: "out",
      label: "実行エラー",
      payload: { message },
    });
    emit({ type: "agent.error", data: { message } });
    try {
      await persistIo();
    } catch {
      // 保存失敗でも SSE のエラーは返す
    }
  }
}
