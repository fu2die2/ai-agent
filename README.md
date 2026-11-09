# Agent Studio (`ai-ajent`)

Next.js 16 で動く AI エージェントのポートフォリオ用 MVP です。ユーザー指示を Backend の Orchestrator が受け取り、許可された Tool だけを実行し、Verifier が結果を検証します。

モデルは Google Gemini（無料枠の `gemini-3.5-flash-lite`）です。混雑や上限時は別モデルへ自動で切り替えます。

## できること

- チャット UI + Execution Trace
- SSE による実行状況のストリーミング
- Tool: `searchKnowledge` / `calculate` / `saveMemo`
- Verifier による回答検証
- `GEMINI_API_KEY` がなくてもデモモードで Tool 実行を確認可能

## 起動

```bash
cp .env.example .env.local
# Google AI Studio で無料の GEMINI_API_KEY を発行して入れる

npm run db:migrate
npm run dev
```

キーは [Google AI Studio](https://aistudio.google.com/apikey) から取得できます。メモは Prisma + PostgreSQL に保存します。

ブラウザで http://localhost:3000 を開きます。

例:

> 東京と大阪の人口を調べて、比較して。結果をメモに保存して。
