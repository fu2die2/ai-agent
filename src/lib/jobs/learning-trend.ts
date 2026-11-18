/**
 * 学習 DB へ「今日の技術トレンド」ページを1件作るジョブ。
 * チャットの Orchestrator は使わず、Gemini 検索 → Notion 作成 → LINE 通知。
 */
import { generateSearchAnswer, hasGeminiKey } from "@/lib/ai/client";
import {
  createNotionPage,
  listNotionPages,
  resolveLearningDatabaseId,
} from "@/lib/knowledge/notion-write";
import { hasLineConfig, pushLineText } from "@/lib/notify/line";

export type LearningTrendResult =
  | { status: "skipped"; reason: string; date: string }
  | {
      status: "created";
      date: string;
      title: string;
      topic: string;
      pageId: string;
      url: string;
      notified: boolean;
    };

/** アジア/東京の当日を YYYY-MM-DD にする。 */
export function todayJst(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** アジア/東京の時（00〜23）。 */
export function jstHour(now = new Date()) {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).format(now);
  return hour.replace(/[^\d]/g, "").padStart(2, "0").slice(-2);
}

/** この実行枠。例: 2026-11-19-02 / 2026-11-19-11 */
export function runSlot(now = new Date()) {
  return `${todayJst(now)}-${jstHour(now)}`;
}

function parseJsonObject(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced?.[1] ?? trimmed).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("トピック選定の JSON を読めませんでした");
  }
  return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
}

function stripMarkdownFence(text: string) {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/);
  return (match?.[1] ?? trimmed).trim();
}

/** 既存タイトルとぶつからないトレンドを1件選ぶ。 */
async function pickTopic(existingTitles: string[]) {
  const listed = existingTitles.slice(0, 80).map((title) => `- ${title}`).join("\n") || "- （なし）";
  const result = await generateSearchAnswer(
    [
      "直近1〜2週間のソフトウェア・AI・Web の技術トレンドを調べてください。",
      "既存の学習ページと重複しないトピックを1つだけ選んでください。",
      "フレームワークの新版、API、ランタイム、セキュリティ、開発者向けツールを優先してください。",
      "出力は JSON のみ。キー: topic（短い日本語タイトル）, reason（選んだ理由）, summary（1行要約）。",
      "",
      "既存タイトル:",
      listed,
    ].join("\n"),
  );
  const parsed = parseJsonObject(result.text);
  const topic = String(parsed.topic ?? "").trim();
  const summary = String(parsed.summary ?? parsed.reason ?? "").trim();
  if (!topic) {
    throw new Error("トピック名を取得できませんでした");
  }
  const duplicate = existingTitles.some((title) => title.includes(topic));
  if (duplicate) {
    throw new Error(`既存ページと重複するトピックです: ${topic}`);
  }
  return { topic, summary };
}

/** 学習 DB 向けの詳しく実務寄りの本文を生成する。 */
async function writeArticle(topic: string) {
  const result = await generateSearchAnswer(
    [
      `テーマ: ${topic}`,
      "日本語で、実務レベルの技術解説ページを書いてください。",
      "条件（ユーザー指定がなくても必ず守る）:",
      "- 詳しく",
      "- 実務レベルで",
      "- 長文でも可（要約や箇条書きだけで終わらせない）",
      "- コード解説付き（動く最小例を言語名付きの Markdown フェンスで書き、直後に解説する）",
      "構成: 背景となぜ今トレンドか / 何が変わるか / 実務での使い方 / コード例と解説 / 注意点 / 参考リンク。",
      "参考リンクは必ず1行ずつ `- [タイトル](https://...)` にする。タイトルと URL を別の箇条書きに分けない。",
      "番号付きの項目の下に箇条書きを置くときは、2スペースでインデントする。番号は 1. 2. 3. と連番にする。",
      "Markdown 本文だけを返す。タイトル行はページタイトルと重複するので書かない。",
    ].join("\n"),
  );
  const content = stripMarkdownFence(result.text);
  if (content.length < 400) {
    throw new Error("生成本文が短すぎます");
  }
  return content;
}

/** この時刻枠のページが無ければ学習 DB に1ページ作り、LINE へ通知する。 */
export async function runLearningTrendJob(): Promise<LearningTrendResult> {
  const date = runSlot();
  if (!hasGeminiKey()) {
    throw new Error("GEMINI_API_KEY がありません");
  }

  const databaseId = await resolveLearningDatabaseId();
  const pages = await listNotionPages(undefined, databaseId);
  const existing = pages.find((page) => page.title.startsWith(date));
  if (existing) {
    return {
      status: "skipped",
      reason: `この時刻枠は作成済みです: ${existing.title}`,
      date,
    };
  }

  const { topic, summary } = await pickTopic(pages.map((page) => page.title));
  const content = await writeArticle(topic);
  const title = `${date} ${topic}`.slice(0, 80);
  const page = await createNotionPage({
    title,
    content,
    category: "開発",
    keywords: `トレンド,${topic}`,
    databaseId,
  });

  let notified = false;
  if (hasLineConfig()) {
    await pushLineText(
      [
        "学習DBに今日のトレンドを書きました。",
        title,
        summary ? summary : "",
        page.url,
      ]
        .filter(Boolean)
        .join("\n"),
    );
    notified = true;
  }

  return {
    status: "created",
    date,
    title: page.title,
    topic,
    pageId: page.id,
    url: page.url,
    notified,
  };
}

/** ジョブ失敗を LINE に短く伝える。未設定なら何もしない。 */
export async function notifyLearningTrendFailure(error: unknown) {
  if (!hasLineConfig()) return;
  const message = error instanceof Error ? error.message : String(error);
  await pushLineText(`学習DBの定時トレンド作成に失敗しました。\n${message.slice(0, 400)}`);
}
