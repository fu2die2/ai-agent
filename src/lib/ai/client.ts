import {
  GoogleGenerativeAI,
  type Content,
  type FunctionDeclaration,
  type GenerativeModel,
  type Tool,
} from "@google/generative-ai";

let client: GoogleGenerativeAI | null = null;

const FALLBACK_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-3.8-flash",
];

const RETRIES_ON_UNAVAILABLE = 2;

export function hasGeminiKey() {
  return Boolean(process.env.GEMINI_API_KEY);
}

export function getModel() {
  return process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite";
}

function modelCandidates() {
  const preferred = getModel();
  return [preferred, ...FALLBACK_MODELS.filter((model) => model !== preferred)];
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function isQuotaError(error: unknown) {
  const message = errorMessage(error);
  return (
    message.includes("429") ||
    message.includes("quota") ||
    message.includes("Too Many Requests")
  );
}

export function isUnavailableError(error: unknown) {
  const message = errorMessage(error);
  return (
    message.includes("503") ||
    message.includes("high demand") ||
    message.includes("Service Unavailable") ||
    message.includes("UNAVAILABLE")
  );
}

function isRetryableError(error: unknown) {
  return isQuotaError(error) || isUnavailableError(error);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

export async function generateText(prompt: string, systemInstruction?: string) {
  return withModelFallback(async (modelName) => {
    const model = getGeminiModel(modelName, { systemInstruction });
    const result = await model.generateContent(prompt);
    return result.response.text();
  });
}

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

export async function generateJson(prompt: string, systemInstruction: string) {
  return withModelFallback(async (modelName) => {
    const model = getGeminiModel(modelName, { systemInstruction, json: true });
    const result = await model.generateContent(prompt);
    return result.response.text();
  });
}

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
    const modelContent = response.candidates?.[0]?.content;
    const functionCalls = (modelContent?.parts ?? [])
      .map((part) => part.functionCall)
      .filter((call): call is NonNullable<typeof call> => Boolean(call));
    if (functionCalls.length > 0) {
      return { modelContent, functionCalls, text: "" };
    }
    return { modelContent, functionCalls: [], text: response.text() };
  });
}
