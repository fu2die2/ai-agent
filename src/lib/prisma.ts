/**
 * Prisma クライアントの単一インスタンス。
 *
 * Proxy は使わない。Next のバンドルでは Proxy 経由だと
 * chatSession が undefined になり findMany で落ちる。
 */
import { PrismaClient } from "@prisma/client";
import { resolveDatabaseUrl } from "@/lib/db-url";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaUrl?: string;
};

/** PostgreSQL 向け PrismaClient を作る。SQLite の URL は拒否する。 */
function createPrismaClient() {
  const connectionString = resolveDatabaseUrl();
  if (!connectionString) {
    throw new Error("DATABASE_URL が設定されていません");
  }
  if (connectionString.startsWith("file:")) {
    throw new Error("DATABASE_URL が SQLite のままです。PostgreSQL の接続文字列を設定してください");
  }

  return new PrismaClient({
    datasources: {
      db: { url: connectionString },
    },
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

const connectionString = resolveDatabaseUrl();
const cached = globalForPrisma.prisma;
const cacheOk =
  cached &&
  globalForPrisma.prismaUrl === connectionString &&
  typeof cached.chatSession?.findMany === "function";

export const prisma = cacheOk ? cached : createPrismaClient();

globalForPrisma.prisma = prisma;
globalForPrisma.prismaUrl = connectionString;
