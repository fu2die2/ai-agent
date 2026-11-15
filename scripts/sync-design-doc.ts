/**
 * docs/design.md を設計書 Notion DB へ upsert する。
 * RAG は社内文書 DB と設計書 DB の両方を読む。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { APP_DESIGN_DOC_TITLE, upsertAppDesignDoc } from "../src/lib/knowledge/notion-write";

async function main() {
  const file = path.join(process.cwd(), "docs/design.md");
  const content = await readFile(file, "utf8");
  const page = await upsertAppDesignDoc(content);
  console.log(
    page.created ? "作成しました" : "更新しました",
    APP_DESIGN_DOC_TITLE,
    page.url,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
