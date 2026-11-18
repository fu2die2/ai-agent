/**
 * 学習 DB 定時ジョブの HTTP 入口。
 * Vercel Cron は GET。GitHub Actions や手動は POST でも可。
 * Authorization: Bearer CRON_SECRET が必須。
 */
import { envExactOrPrefixed } from "@/lib/db-url";
import { notifyLearningTrendFailure, runLearningTrendJob } from "@/lib/jobs/learning-trend";

export const maxDuration = 120;

function isAuthorized(request: Request) {
  const secret = envExactOrPrefixed("CRON_SECRET");
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

async function handle(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await runLearningTrendJob();
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await notifyLearningTrendFailure(error);
    } catch {
      // 失敗通知が送れなくても本体エラーを返す
    }
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
