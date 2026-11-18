/**
 * LINE Messaging API の push。
 * LINE Notify は終了しているので使わない。
 */
import { envExactOrPrefixed } from "@/lib/db-url";

const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";

function lineToken() {
  return envExactOrPrefixed("LINE_CHANNEL_ACCESS_TOKEN");
}

function lineTo() {
  return envExactOrPrefixed("LINE_TO");
}

/** トークンと送信先が揃っているか。無いときは push をスキップする。 */
export function hasLineConfig() {
  return Boolean(lineToken() && lineTo());
}

/** 1通のテキストメッセージを LINE_TO へ送る。未設定なら何もしない。 */
export async function pushLineText(text: string) {
  const token = lineToken();
  const to = lineTo();
  if (!token || !to) {
    return { sent: false as const, skipped: true as const };
  }
  const body = text.trim().slice(0, 4900);
  const response = await fetch(LINE_PUSH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to,
      messages: [{ type: "text", text: body }],
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`LINE push に失敗しました (${response.status}): ${detail.slice(0, 300)}`);
  }
  return { sent: true as const, skipped: false as const };
}
