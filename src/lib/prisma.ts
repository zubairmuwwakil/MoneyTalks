import "server-only";

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  pgPool?: Pool;
};

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

function readPoolSetting(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

const pool =
  globalForPrisma.pgPool ??
  new Pool({
    connectionString,
    max: readPoolSetting("DATABASE_POOL_MAX", 5),
    idleTimeoutMillis: readPoolSetting("DATABASE_IDLE_TIMEOUT_MS", 10_000),
    connectionTimeoutMillis: readPoolSetting("DATABASE_CONNECTION_TIMEOUT_MS", 5_000),
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.pgPool = pool;

const adapter = new PrismaPg(pool);

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
