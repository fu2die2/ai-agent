/**
 * Vercel の npm run build。
 * 接頭辞付きの DB URL を DATABASE_URL に寄せてから、
 * generate → migrate deploy（chat_sessions などを作る）→ next build。
 */
import { spawnSync } from "node:child_process";

function envExactOrPrefixed(name) {
  const exact = process.env[name];
  if (exact) return exact;
  const suffix = `_${name}`;
  for (const [key, value] of Object.entries(process.env)) {
    if (value && key.endsWith(suffix)) return value;
  }
  return "";
}

const direct =
  envExactOrPrefixed("DATABASE_URL") ||
  envExactOrPrefixed("PRISMA_DATABASE_URL") ||
  envExactOrPrefixed("POSTGRES_URL") ||
  envExactOrPrefixed("DATABASE_URL_POOLED");

if (direct) {
  process.env.DATABASE_URL = direct;
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", env: process.env, shell: false });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("npx", ["prisma", "generate"]);

if (!process.env.DATABASE_URL) {
  console.error(
    "DATABASE_URL がありません。Vercel Storage の Prisma Postgres を Connect してください。",
  );
  process.exit(1);
}

run("npx", ["prisma", "migrate", "deploy"]);
run("npx", ["next", "build"]);
