import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Seeded mock contacts have no externalKey; real synced contacts always do.
// Deleting them cascades to their conversations and messages. Tag definitions
// are kept so they can be applied to real contacts.
async function main() {
  const mock = await prisma.contact.findMany({
    where: { externalKey: null },
    select: { id: true, name: true },
  });
  if (mock.length === 0) {
    console.log("No mock contacts found — nothing to clean.");
    return;
  }
  const result = await prisma.contact.deleteMany({
    where: { externalKey: null },
  });
  console.log(
    `Removed ${result.count} mock contacts: ${mock.map((m) => m.name).join(", ")}`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
