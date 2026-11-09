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
