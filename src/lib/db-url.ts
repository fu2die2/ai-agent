/**
 * Vercel Storage は接頭辞なしなら DATABASE_URL、
 * 接頭辞ありなら AI_AGENT_PRISMA_DATABASE_URL のように名前が変わる。
 */
export function envExactOrPrefixed(name: string) {
  const exact = process.env[name];
  if (exact) return exact;
  const suffix = `_${name}`;
  for (const [key, value] of Object.entries(process.env)) {
    if (value && key.endsWith(suffix)) return value;
  }
  return "";
}

/** アプリ用。プール接続を優先する。 */
export function resolveDatabaseUrl() {
  return (
    envExactOrPrefixed("DATABASE_URL_POOLED") ||
    envExactOrPrefixed("DATABASE_URL") ||
    envExactOrPrefixed("PRISMA_DATABASE_URL") ||
    envExactOrPrefixed("POSTGRES_URL")
  );
}

/** migrate 用。直結を優先する。 */
export function resolveDirectDatabaseUrl() {
  return (
    envExactOrPrefixed("DATABASE_URL") ||
    envExactOrPrefixed("PRISMA_DATABASE_URL") ||
    envExactOrPrefixed("POSTGRES_URL") ||
    envExactOrPrefixed("DATABASE_URL_POOLED")
  );
}
