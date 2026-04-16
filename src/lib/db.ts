import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

declare global {
  // eslint-disable-next-line no-var
  var _prisma: PrismaClient | undefined;
}

/**
 * Normalise the DATABASE_URL for pg compatibility.
 * pg v9 deprecates 'sslmode=require' — map it to 'sslmode=verify-full'
 * to silence the SECURITY WARNING and adopt the safer behaviour now.
 */
function normaliseDatabaseUrl(raw: string): string {
  return raw.replace(/sslmode=require(&|$)/, "sslmode=verify-full$1");
}

/**
 * Returns a singleton PrismaClient using the pg driver adapter (Prisma 7).
 * Lazy — only instantiated on first call, never at module evaluation time.
 * This prevents build-time failures on Vercel where DATABASE_URL is not
 * available during the Next.js static analysis phase.
 */
export function getPrisma(): PrismaClient {
  if (globalThis._prisma) return globalThis._prisma;

  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL environment variable is not set");

  const url = normaliseDatabaseUrl(raw);
  const adapter = new PrismaPg(url);
  const client = new PrismaClient({ adapter });

  if (process.env.NODE_ENV !== "production") {
    globalThis._prisma = client;
  }

  return client;
}

/**
 * Proxy so existing `prisma.xxx` call-sites work unchanged.
 * The actual PrismaClient is created on the first property access.
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    return getPrisma()[prop as keyof PrismaClient];
  },
});
