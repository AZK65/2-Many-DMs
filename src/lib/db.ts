import { PrismaClient } from "@prisma/client";
import { configureSqlite } from "@/lib/sqlite";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaReady?: Promise<void>;
};

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient();

export const prismaReady =
  globalForPrisma.prismaReady ?? configureSqlite(prisma);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaReady = prismaReady;
}
