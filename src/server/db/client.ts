import { PrismaClient } from "@prisma/client";

/**
 * Prisma client singleton. Next.js hot-reloads server modules in dev, which
 * would otherwise create a new PrismaClient (and a new DB connection pool)
 * on every reload — so we stash it on `globalThis` in development.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
