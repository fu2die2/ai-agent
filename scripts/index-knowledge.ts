/**
 * Notion の社内ページを取得し、チャンク化・埋め込みして Postgres に入れる CLI。
 *
 *   npm run knowledge:index
 *
 * 未実行でも検索時に自動で走るが、初回はここで確認した方が失敗原因が見やすい。
 */
import { ensureKnowledgeIndex } from "../src/lib/knowledge/indexer";

/** インデックスを実行し、作成したか既存利用かを標準出力に出す。 */
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
