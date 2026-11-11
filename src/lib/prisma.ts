/**
 * Prisma クライアントの単一インスタンス。
 *
 * Next.js の dev ではモジュールがホットリロードされるため、
 * globalThis に載せて接続が増えすぎないようにしている。
 * クライアントは最初のクエリまで作らない（ビルド時に URL が無くても落ちない）。
 */
import { PrismaClient } from "@prisma/client";
import { resolveDatabaseUrl } from "@/lib/db-url";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaUrl?: string;
};

/** 実行時の接続文字列。 */
function databaseUrl() {
  return resolveDatabaseUrl();
}

/** PostgreSQL 向け PrismaClient を作る。SQLite の URL は拒否する。 */
function createPrismaClient() {
  const connectionString = databaseUrl();
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

/** 同じ URL なら使い回し、無ければ作る。 */
function getPrisma() {
  const connectionString = databaseUrl();
  if (globalForPrisma.prisma && globalForPrisma.prismaUrl === connectionString) {
    return globalForPrisma.prisma;
  }
  const client = createPrismaClient();
  globalForPrisma.prisma = client;
  globalForPrisma.prismaUrl = connectionString;
  return client;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    const client = getPrisma();
    const value = Reflect.get(client, property, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
