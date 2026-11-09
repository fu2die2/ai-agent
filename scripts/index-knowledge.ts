import { ensureKnowledgeIndex } from "../src/lib/knowledge/indexer";

async function main() {
  const result = await ensureKnowledgeIndex();
  console.log(
    result.indexed
      ? `RAGインデックスを作成しました: ${result.count} チャンク (${result.model})`
      : `既存インデックスを利用します: ${result.count} チャンク (${result.model})`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
