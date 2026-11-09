"use client";

/** エージェント回答の見出し・箇条書き・表を HTML にする。GFM（表など）対応。 */

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** content を Markdown として描画する。tone でユーザー/エージェントの色を分ける。 */
export function MarkdownBody({
  content,
  tone = "assistant",
}: {
  content: string;
  tone?: "assistant" | "user";
}) {
  return (
    <div className={`markdown-body markdown-${tone}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
