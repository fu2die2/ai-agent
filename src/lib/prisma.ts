/**
 * Prisma クライアントの単一インスタンス。
 *
 * Next.js の dev ではモジュールがホットリロードされるため、
 * globalThis に載せて接続が増えすぎないようにしている。
 * URL が変わったら作り直す（SQLite → PostgreSQL 切り替え時の取り違え防止）。
 */
import { PrismaClient } from "@prisma/client";

const connectionString = process.env.DATABASE_URL;

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaUrl?: string;
};

/** PostgreSQL 向け PrismaClient を作る。SQLite の URL は拒否する。 */
function createPrismaClient() {
  if (!connectionString) {
    throw new Error("DATABASE_URL が設定されていません");
  }
  // 以前 SQLite だった頃の接続文字列が残っていると readonly エラーになる
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

export const prisma =
  globalForPrisma.prisma && globalForPrisma.prismaUrl === connectionString
    ? globalForPrisma.prisma
    : createPrismaClient();

globalForPrisma.prisma = prisma;
globalForPrisma.prismaUrl = connectionString;
