/**
 * docs/design.md を社内ナレッジ Notion へ upsert する。
 * RAG は NOTION_DATABASE_ID だけを読むので、設計書もそこに置く。
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
