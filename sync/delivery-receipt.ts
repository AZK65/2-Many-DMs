import type { PrismaClient } from "@prisma/client";
import type { SentMessage } from "./adapters/types";

// An inbox echo can confirm a send before the browser's send() returns. Never
// replace that receipt with a provisional ID and re-arm the echo watchdog.
export async function recordDeliveryReceipt(prisma: PrismaClient, id: string, sent: SentMessage) {
  return prisma.message.updateMany({
    where: {
      id,
      ...(sent.messageExternalId.includes(":pending:") ? {
        OR: [
          { externalKey: null },
          { externalKey: { contains: ":pending:" } },
          { deliveryStatus: { not: "sent" } },
        ],
      } : {}),
    },
    data: {
      externalKey: sent.messageExternalId,
      createdAt: new Date(sent.timestamp),
      deliveryStatus: "sent",
      deliveryError: null,
    },
  });
}
