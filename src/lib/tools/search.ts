import type { JsonValue } from "@/types/tool";

type KnowledgeDoc = {
  title: string;
  source: string;
  content: string;
};

const KNOWLEDGE_BASE: KnowledgeDoc[] = [
  {
    title: "React と Next.js の違い",
    source: "Agent Studio Knowledge",
    content:
      "ReactはUIを構築するためのライブラリ。コンポーネント、状態、フックが中心。Next.jsはReact上のフルスタックフレームワークで、App Router、サーバーコンポーネント、ルーティング、API Routes、SSR/SSG、画像最適化などを提供する。UI部品だけならReact、アプリ全体を作るならNext.jsが適する。",
  },
  {
    title: "東京都の人口",
    source: "公開統計の概算（ポートフォリオ用サンプル）",
    content:
      "東京都の人口は約1,400万人。日本の都道府県で最多。23区部に人口が集中している。",
  },
  {
    title: "大阪府の人口",
    source: "公開統計の概算（ポートフォリオ用サンプル）",
    content:
      "大阪府の人口は約880万人。東京都に次ぐ規模の大都市圏で、大阪市を中心に商業・サービス業が集積している。",
  },
  {
    title: "RAG（Retrieval-Augmented Generation）",
    source: "Agent Studio Knowledge",
    content:
      "RAGは検索拡張生成。LLMが回答する前に外部文書を検索し、その内容を根拠に生成する。社内規定や独自データへの回答精度を上げる。AIエージェントのToolの1つとしても使える。",
  },
  {
    title: "AIエージェントの実行方針",
    source: "Agent Studio Knowledge",
    content:
      "ユーザー指示をBackendのOrchestratorが受け取り、AIがToolを選択し、Backendが許可されたToolだけを実行する。結果はVerifier AIが検証してから返す。ToolはsearchKnowledge、answerQuestion、calculate、saveMemoを利用できる。",
  },
];

function scoreDoc(query: string, doc: KnowledgeDoc) {
  const hay = `${doc.title}\n${doc.content}`.toLowerCase();
  const q = query.toLowerCase();
  let score = 0;
  for (const term of q.match(/[a-z0-9]{2,}/g) ?? []) {
    if (hay.includes(term)) score += 2;
  }
  for (let i = 0; i < q.length - 1; i += 1) {
    const gram = q.slice(i, i + 2);
    if (/[ぁ-んァ-ン一-龯]{2}/.test(gram) && hay.includes(gram)) {
      score += 1;
    }
  }
  return score;
}

export async function searchKnowledge(
  args: Record<string, JsonValue>,
): Promise<JsonValue> {
  const query = String(args.query ?? "");
  if (!query.trim()) {
    return { results: [], message: "query が空です" };
  }

  const ranked = KNOWLEDGE_BASE.map((doc) => ({
    ...doc,
    score: scoreDoc(query, doc),
  }))
    .filter((doc) => doc.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (ranked.length === 0) {
    return {
      results: [],
      message:
        "ナレッジベースに一致する文書はありませんでした。一般質問なら answerQuestion を使ってください。",
    };
  }

  return {
    results: ranked.map(({ title, source, content }) => ({
      title,
      source,
      content,
    })),
  };
}
