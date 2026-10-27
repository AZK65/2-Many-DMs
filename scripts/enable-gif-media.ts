import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { normalizeMessageContent, proto } from "@whiskeysockets/baileys";
import { DurableRecords } from "../sync/retention";

// Scoped, additive upgrade for existing SQLite installations. No db push,
// account connections, message replay, unread changes, or network requests.
async function main() {
  const prisma = new PrismaClient();
  const apply = process.argv.includes("--apply");
  try {
    await prisma.$queryRawUnsafe("PRAGMA busy_timeout = 15000");
    const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>('PRAGMA table_info("Message")');
    if (!columns.some(column => column.name === "mediaIsGif")) {
      if (!apply) { console.log("GIF metadata column needs an additive migration. Run with --apply."); return; }
      await prisma.$executeRawUnsafe('ALTER TABLE "Message" ADD COLUMN "mediaIsGif" BOOLEAN NOT NULL DEFAULT false');
    }
    const accounts = await prisma.account.findMany({ where: { platform: "whatsapp" }, select: { id: true } });
    let checked = 0, identified = 0, unavailable = 0;
    for (const account of accounts) {
      const directory = path.join(process.env.DATA_DIR || process.cwd(), ".local", "whatsapp-messages", account.id);
      if (!fs.existsSync(path.join(directory, ".key"))) continue;
      const cache = new DurableRecords<string>(directory);
      const messages = await prisma.message.findMany({
        where: { conversation: { accountId: account.id }, mediaType: "video", mediaIsGif: false, externalKey: { not: null } },
        select: { id: true, externalKey: true },
      });
      for (const message of messages) {
        checked++;
        try {
          const key = message.externalKey!;
          const raw = cache.get(key) || cache.get(key.replace(/@c\.us(?=:|$)/g, "@s.whatsapp.net"));
          if (!raw) { unavailable++; continue; }
          const record = proto.WebMessageInfo.decode(Buffer.from(raw, "base64"));
          const content = normalizeMessageContent(record.message);
          if (content?.videoMessage?.gifPlayback !== true) continue;
        } catch { unavailable++; continue; }
        identified++;
        // Database failures must fail the upgrade, not masquerade as a cache miss.
        if (apply) await prisma.message.update({ where: { id: message.id }, data: { mediaIsGif: true } });
      }
    }
    console.log(JSON.stringify({ apply, checked, identified, unavailable }));
  } finally { await prisma.$disconnect(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
