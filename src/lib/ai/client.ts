/**
 * Gemini 呼び出しの窓口。
 *
 * 無料枠はモデルごとに上限・混雑（429/503）が出やすいので、
 * 希望モデル → フォールバック一覧の順で試し、503 は短くリトライする。
 * エージェントの function calling と、一般質問の Google Search もここ。
 */
import {
  GoogleGenerativeAI,
  type Content,
  type FunctionDeclaration,
  type GenerativeModel,
  type Tool,
} from "@google/generative-ai";

let client: GoogleGenerativeAI | null = null;

/** 希望モデルが 429/503 のときに順に倒す候補。無料枠で動きやすいものを前に置く。 */
const FALLBACK_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-3.8-flash",
];

const RETRIES_ON_UNAVAILABLE = 2;

/** GEMINI_API_KEY があるか。無いと Orchestrator はデモプランになる。 */
export function hasGeminiKey() {
  return Boolean(process.env.GEMINI_API_KEY);
}

/** 希望モデル名。未指定なら 3.5-flash-lite。 */
export function getModel() {
  return process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite";
}

/** 希望モデルを先頭に、重複を除いたフォールバック順。 */
function modelCandidates() {
  const preferred = getModel();
  return [preferred, ...FALLBACK_MODELS.filter((model) => model !== preferred)];
}

/** unknown な catch 値を文字列にする。 */
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** 日次上限などの 429 か。このときは別モデルへ切り替える。 */
export function isQuotaError(error: unknown) {
  const message = errorMessage(error);
  return (
    message.includes("429") ||
    message.includes("quota") ||
    message.includes("Too Many Requests")
  );
}

/** 混雑の 503 か。同じモデルを短く待って再試行する。 */
export function isUnavailableError(error: unknown) {
  const message = errorMessage(error);
  return (
    message.includes("503") ||
    message.includes("high demand") ||
    message.includes("Service Unavailable") ||
    message.includes("UNAVAILABLE")
  );
}

/** フォールバック対象のエラーか（429 または 503）。 */
function isRetryableError(error: unknown) {
  return isQuotaError(error) || isUnavailableError(error);
}

/** 指定ミリ秒待つ。503 リトライの間隔用。 */
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** SDK クライアントを1つだけ作って使い回す。 */
export function getGemini() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY が設定されていません");
  }
  if (!client) {
    client = new GoogleGenerativeAI(apiKey);
  }
  return client;
}

/** システム指示・Tool・JSON 出力の有無を付けた GenerativeModel を返す。 */
export function getGeminiModel(
  modelName: string,
  options?: {
    systemInstruction?: string;
    tools?: FunctionDeclaration[];
    extraTools?: Tool[];
    json?: boolean;
  },
): GenerativeModel {
  const tools: Tool[] = [];
  if (options?.tools?.length) {
    tools.push({ functionDeclarations: options.tools });
  }
  if (options?.extraTools?.length) {
    tools.push(...options.extraTools);
  }
  return getGemini().getGenerativeModel({
    model: modelName,
    systemInstruction: options?.systemInstruction,
    tools: tools.length ? tools : undefined,
    generationConfig: options?.json
      ? { temperature: 0, responseMimeType: "application/json" }
      : { temperature: 0.3 },
  });
}

/** モデルを順に試し、クォータ切れなら次へ、一時障害なら同じモデルを再試行。 */
async function withModelFallback<T>(run: (modelName: string) => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (const modelName of modelCandidates()) {
    for (let attempt = 0; attempt <= RETRIES_ON_UNAVAILABLE; attempt += 1) {
      try {
        return await run(modelName);
      } catch (error) {
        lastError = error;
        if (isUnavailableError(error) && attempt < RETRIES_ON_UNAVAILABLE) {
          await sleep(700 * (attempt + 1));
          continue;
        }
        if (!isRetryableError(error)) {
          throw error;
        }
        break;
      }
    }
  }
  throw lastError;
}

/** プレーンテキストを1回生成する。Verifier 不合格後の書き直しでも使う。 */
export async function generateText(prompt: string, systemInstruction?: string) {
  return withModelFallback(async (modelName) => {
    const model = getGeminiModel(modelName, { systemInstruction });
    const result = await model.generateContent(prompt);
    return result.response.text();
  });
}

/**
 * 一般質問用。googleSearch がモデルによって非対応なので
 * googleSearchRetrieval も試し、だめなら検索なしで生成する。
 */
export async function generateSearchAnswer(question: string) {
  const systemInstruction =
    "あなたは事実質問に答える調査アシスタントです。必要なら検索して、日本語で簡潔に答えてください。不確かな点は断定しないでください。出典があれば本文に含めてください。";
  const prompt = `質問:\n${question}`;
  const searchTools: Tool[][] = [
    [{ googleSearch: {} } as Tool],
    [{ googleSearchRetrieval: {} }],
  ];

  return withModelFallback(async (modelName) => {
    let lastError: unknown;
    for (const extraTools of searchTools) {
      try {
        const model = getGeminiModel(modelName, {
          systemInstruction,
          extraTools,
        });
        const result = await model.generateContent(prompt);
        const text = result.response.text().trim();
        const chunks = result.response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
        const sources = chunks
          .map((chunk) => ({
            title: chunk.web?.title ?? "検索結果",
            url: chunk.web?.uri ?? "",
          }))
          .filter((item) => item.url);
        if (text) {
          return { text, sources, searched: true as const };
        }
      } catch (error) {
        lastError = error;
        const message = errorMessage(error);
        if (isQuotaError(error) || isUnavailableError(error)) {
          throw error;
        }
        if (
          !message.includes("400") &&
          !message.includes("INVALID_ARGUMENT") &&
          !message.includes("not supported")
        ) {
          throw error;
        }
      }
    }

    const model = getGeminiModel(modelName, { systemInstruction });
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    if (!text && lastError) {
      throw lastError;
    }
    return { text, sources: [], searched: false as const };
  });
}

/** JSON だけを返す生成。Verifier の合否判定用。 */
export async function generateJson(prompt: string, systemInstruction: string) {
  return withModelFallback(async (modelName) => {
    const model = getGeminiModel(modelName, { systemInstruction, json: true });
    const result = await model.generateContent(prompt);
    return result.response.text();
  });
}

/** Gemini 3 の functionCall に付く思考署名。part か functionCall のどちらに来ても拾う。 */
type ThoughtfulPart = Content["parts"][number] & {
  thoughtSignature?: string;
  thought_signature?: string;
  thought?: boolean;
  functionCall?: { name: string; args: object; thoughtSignature?: string; thought_signature?: string };
};

const SKIP_THOUGHT_SIGNATURE = "skip_thought_signature_validator";

/** part から thought_signature を取る。 */
function thoughtSignatureOf(part: ThoughtfulPart): string | undefined {
  if (typeof part.thoughtSignature === "string" && part.thoughtSignature) {
    return part.thoughtSignature;
  }
  if (typeof part.thought_signature === "string" && part.thought_signature) {
    return part.thought_signature;
  }
  const call = part.functionCall;
  if (call && typeof call.thoughtSignature === "string" && call.thoughtSignature) {
    return call.thoughtSignature;
  }
  if (call && typeof call.thought_signature === "string" && call.thought_signature) {
    return call.thought_signature;
  }
  return undefined;
}

/**
 * 次の generateContent にそのまま返せる model content にする。
 * Gemini 3 は各ステップ先頭の functionCall に thought_signature が無いと 400 になる。
 * 並列呼び出しは先頭だけ署名があればよい。無いときだけ skip を付ける。
 */
export function preserveModelContent(
  content: Content | undefined,
  fallbackCalls: Array<{ name: string; args: object }>,
): Content {
  const parts: ThoughtfulPart[] = content?.parts?.length
    ? (content.parts.map((part) => ({ ...part })) as ThoughtfulPart[])
    : fallbackCalls.map((call) => ({ functionCall: call }));

  let carry: string | undefined;
  let signedFirstCall = false;
  for (const part of parts) {
    const signature = thoughtSignatureOf(part);
    if (signature) carry = signature;
    if (!part.functionCall) continue;
    const assigned = thoughtSignatureOf(part) || (!signedFirstCall ? carry ?? SKIP_THOUGHT_SIGNATURE : undefined);
    if (assigned) {
      part.thoughtSignature = assigned;
      part.thought_signature = assigned;
    }
    signedFirstCall = true;
  }

  return {
    role: content?.role || "model",
    parts,
  };
}

/**
 * 1ターン分。テキスト回答か functionCall の配列が返る。
 * functionCall があるときは text を使わず、Tool 実行後に会話へ戻す。
 * 返した modelContent は thought_signature 付きのまま次ターンへ渡す。
 */
export async function generateAgentTurn(options: {
  systemInstruction: string;
  tools: FunctionDeclaration[];
  contents: Content[];
}) {
  return withModelFallback(async (modelName) => {
    const model = getGeminiModel(modelName, {
      systemInstruction: options.systemInstruction,
      tools: options.tools,
    });
    const result = await model.generateContent({ contents: options.contents });
    const response = result.response;
    const rawContent = response.candidates?.[0]?.content;
    const functionCalls = (rawContent?.parts ?? [])
      .map((part) => part.functionCall)
      .filter((call): call is NonNullable<typeof call> => Boolean(call));
    const modelContent = preserveModelContent(rawContent, functionCalls);
    if (functionCalls.length > 0) {
      return { modelName, modelContent, functionCalls, text: "" };
    }
    return { modelName, modelContent, functionCalls: [], text: response.text() };
  });
}
