import { PrismaClient } from "@prisma/client";

const connectionString = process.env.DATABASE_URL;

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaUrl?: string;
};

function createPrismaClient() {
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

export const prisma =
  globalForPrisma.prisma && globalForPrisma.prismaUrl === connectionString
    ? globalForPrisma.prisma
    : createPrismaClient();

globalForPrisma.prisma = prisma;
globalForPrisma.prismaUrl = connectionString;
