/**
 * 学習 DB へ今日のトレンドページを作る CLI。
 *
 *   npm run learning:trend
 */
import {
  notifyLearningTrendFailure,
  runLearningTrendJob,
} from "../src/lib/jobs/learning-trend";

async function main() {
  try {
    const result = await runLearningTrendJob();
    if (result.status === "skipped") {
      console.log("スキップ", result.date, result.reason);
      return;
    }
    console.log(
      "作成しました",
      result.title,
      result.url,
      result.notified ? "LINE通知済み" : "LINE未設定",
    );
  } catch (error) {
    await notifyLearningTrendFailure(error).catch(() => undefined);
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
