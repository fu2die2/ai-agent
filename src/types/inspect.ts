/**
 * データログ画面と /api/inspect が共有する型。
 * クライアントにはこの型だけ渡し、Prisma はサーバーに残す。
 */
import type { Memo, SessionSummary } from "./agent";

export type KnowledgeChunkView = {
  id: string;
  documentId: string;
  chunkIndex: number;
  title: string;
  category: string;
  source: string;
  url: string;
  keywords: string;
  content: string;
  contentChars: number;
  embeddingDims: number;
  embeddingPreview: number[];
  model: string;
  corpusHash: string;
  createdAt: string;
};

export type InspectSnapshot = {
  generatedAt: number;
  env: {
    gemini: boolean;
    notion: boolean;
    database: boolean;
  };
  stores: {
    sessions: {
      where: string;
      count: number;
      items: SessionSummary[];
    };
    knowledgeChunks: {
      where: string;
      count: number;
      model: string | null;
      corpusHash: string | null;
      items: KnowledgeChunkView[];
    };
    memos: {
      where: string;
      count: number;
      items: Memo[];
    };
  };
  flow: { step: string; detail: string }[];
};
