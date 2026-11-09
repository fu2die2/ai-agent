/**
 * 検索単位のチャンク（文書を短く切った1片）。
 * PostgreSQL の knowledge_chunks 1行にほぼ対応する。
 */
export type KnowledgeChunkInput = {
  id: string;
  documentId: string;
  chunkIndex: number;
  title: string;
  category: string;
  source: string;
  content: string;
  keywords: string[];
};
