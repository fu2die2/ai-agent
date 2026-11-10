/**
 * Notion から取ってきた「1ページ分」の文書。
 * このあと chunk.ts で短い断片に分け、埋め込みして DB に入れる。
 */
export type KnowledgeDoc = {
  id: string;
  title: string;
  category: string;
  source: string;
  /** Notion ページをブラウザで開く URL。 */
  url: string;
  keywords: string[];
  content: string;
  /** Notion の更新時刻。これが変わったら再インデックスする。 */
  lastEditedTime: string;
};
