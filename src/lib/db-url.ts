/**
 * Vercel Storage は接頭辞なしなら DATABASE_URL、
 * 接頭辞ありなら AI_AGENT_PRISMA_DATABASE_URL のように名前が変わる。
 * prisma:// は Accelerate 用で、通常の PrismaClient だと network error になる。
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

/** TCP の Postgres URL だけ使う。ローカルは SSL を付けない。 */
function asPostgresUrl(raw: string) {
  const value = raw.trim();
  if (!/^(postgres|postgresql):\/\//i.test(value)) return "";
  if (/sslmode=/i.test(value)) return value;
  if (/localhost|127\.0\.0\.1/i.test(value)) return value;
  return `${value}${value.includes("?") ? "&" : "?"}sslmode=require`;
}

function firstPostgresUrl(names: string[]) {
  for (const name of names) {
    const url = asPostgresUrl(envExactOrPrefixed(name));
    if (url) return url;
  }
  return "";
}

/**
 * Vercel の各インスタンスが接続を抱えすぎないようにする。
 * 制限を超えると findMany が Timed out fetching a new connection になる。
 */
function withServerlessPool(url: string) {
  if (!url || /localhost|127\.0\.0\.1/i.test(url)) return url;
  const extras: string[] = [];
  if (!/[?&]connection_limit=/.test(url)) extras.push("connection_limit=1");
  if (!/[?&]pool_timeout=/.test(url)) extras.push("pool_timeout=10");
  if (!/[?&]connect_timeout=/.test(url)) extras.push("connect_timeout=10");
  if (extras.length === 0) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${extras.join("&")}`;
}

/** アプリ用。プール接続を優先する。 */
export function resolveDatabaseUrl() {
  return withServerlessPool(
    firstPostgresUrl([
      "DATABASE_URL_POOLED",
      "DATABASE_URL",
      "POSTGRES_URL",
      "PRISMA_DATABASE_URL",
    ]),
  );
}

/** migrate 用。直結を優先する。 */
export function resolveDirectDatabaseUrl() {
  return firstPostgresUrl([
    "DATABASE_URL",
    "PRISMA_DATABASE_URL",
    "POSTGRES_URL",
    "DATABASE_URL_POOLED",
  ]);
}
