import "dotenv/config";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createClient() {
  const url = process.env.DATABASE_URL ?? "file:./dev.db";
  // DATABASE_URL comes in the form "file:./dev.db" — strip "file:" for better-sqlite3.
  const fileName = url.startsWith("file:") ? url.slice("file:".length) : url;
  const adapter = new PrismaBetterSqlite3({ url: fileName });
  return new PrismaClient({ adapter });
}

// In production: singleton to avoid connection pool exhaustion.
// In dev: always create a fresh client so that `prisma generate` changes
// (new models/fields) are immediately picked up after hot-reload — the old
// singleton would keep the stale schema in memory and throw PrismaClientValidationErrors.
export const prisma =
  process.env.NODE_ENV === "production"
    ? (globalForPrisma.prisma ?? (globalForPrisma.prisma = createClient()))
    : createClient();
