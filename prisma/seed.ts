import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type Platform = "x" | "whatsapp" | "telegram";

interface SeedMessage {
  body: string;
  direction: "in" | "out";
  minsAgo: number;
}

interface SeedContact {
  name: string;
  handle: string;
  company?: string;
  notes?: string;
  tags: string[];
  platform: Platform;
  unread?: number;
  messages: SeedMessage[];
}

const TAGS = [
  { name: "Lead", color: "#3b82f6" },
  { name: "Customer", color: "#22c55e" },
  { name: "Partner", color: "#a855f7" },
  { name: "VIP", color: "#eab308" },
  { name: "Cold", color: "#64748b" },
  { name: "Follow up", color: "#f97316" },
];

const CONTACTS: SeedContact[] = [
  {
    name: "Maya Chen",
    handle: "@mayabuilds",
    company: "Northwind Labs",
    notes: "Met at SaaStr. Interested in the enterprise tier.",
    tags: ["Lead", "Follow up"],
    platform: "x",
    unread: 2,
    messages: [
      { body: "Hey! Loved your thread on retention loops.", direction: "in", minsAgo: 240 },
      { body: "Thanks Maya! Glad it resonated.", direction: "out", minsAgo: 235 },
      { body: "Would love to chat about how we could work together.", direction: "in", minsAgo: 12 },
      { body: "Are you free this week for a quick call?", direction: "in", minsAgo: 8 },
    ],
  },
  {
    name: "Diego Alvarez",
    handle: "+34 612 555 019",
    company: "Mercado Fresco",
    notes: "Runs a 3-store grocery chain. Wants the POS integration.",
    tags: ["Customer", "VIP"],
    platform: "whatsapp",
    unread: 1,
    messages: [
      { body: "Buenas! The new dashboard is working great.", direction: "in", minsAgo: 1440 },
      { body: "That's awesome to hear, Diego!", direction: "out", minsAgo: 1430 },
      { body: "One question — can I export the weekly report to PDF?", direction: "in", minsAgo: 45 },
    ],
  },
  {
    name: "Priya Nair",
    handle: "@priya_n",
    company: "Loom Collective",
    notes: "Design partner. Sharp feedback on the onboarding flow.",
    tags: ["Partner"],
    platform: "telegram",
    unread: 0,
    messages: [
      { body: "Pushed the new mockups to Figma 🎨", direction: "in", minsAgo: 600 },
      { body: "Looking now — the empty states are so much cleaner.", direction: "out", minsAgo: 595 },
      { body: "Right? Let me know if the spacing feels off anywhere.", direction: "in", minsAgo: 590 },
      { body: "Will do. Shipping this Friday.", direction: "out", minsAgo: 585 },
    ],
  },
  {
    name: "Tom Becker",
    handle: "@tombeck",
    company: "Indie Hacker",
    notes: "Building a competing tool. Friendly. Good for swapping notes.",
    tags: ["Cold"],
    platform: "x",
    unread: 0,
    messages: [
      { body: "How are you handling webhooks at scale?", direction: "in", minsAgo: 4320 },
      { body: "Queue + retries with backoff. Happy to share more.", direction: "out", minsAgo: 4300 },
    ],
  },
  {
    name: "Aisha Rahman",
    handle: "+1 415 555 0142",
    company: "Brightside Health",
    notes: "Procurement is slow but budget is approved.",
    tags: ["Lead", "VIP"],
    platform: "whatsapp",
    unread: 3,
    messages: [
      { body: "Hi! Following up on the proposal.", direction: "in", minsAgo: 180 },
      { body: "Our team reviewed it and we're impressed.", direction: "in", minsAgo: 160 },
      { body: "Can we get a security questionnaire?", direction: "in", minsAgo: 30 },
    ],
  },
  {
    name: "Lukas Vogt",
    handle: "@lukasv",
    company: "Helio Studio",
    notes: "Referral source. Sent us 2 clients already.",
    tags: ["Partner", "Follow up"],
    platform: "telegram",
    unread: 1,
    messages: [
      { body: "Got another founder who needs what you built.", direction: "in", minsAgo: 90 },
      { body: "Introducing you both later today 🙌", direction: "in", minsAgo: 20 },
    ],
  },
];

async function main() {
  // Clean slate so reseeding is idempotent.
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.contactTag.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.tag.deleteMany();

  const tagByName: Record<string, string> = {};
  for (const t of TAGS) {
    const tag = await prisma.tag.create({ data: t });
    tagByName[t.name] = tag.id;
  }

  const now = Date.now();

  for (const c of CONTACTS) {
    const contact = await prisma.contact.create({
      data: {
        name: c.name,
        handle: c.handle,
        company: c.company,
        notes: c.notes,
        tags: {
          create: c.tags.map((name) => ({ tagId: tagByName[name] })),
        },
      },
    });

    const lastMins = Math.min(...c.messages.map((m) => m.minsAgo));
    const conversation = await prisma.conversation.create({
      data: {
        platform: c.platform,
        contactId: contact.id,
        unread: c.unread ?? 0,
        lastMessageAt: new Date(now - lastMins * 60_000),
      },
    });

    for (const m of c.messages) {
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          body: m.body,
          direction: m.direction,
          createdAt: new Date(now - m.minsAgo * 60_000),
        },
      });
    }
  }

  console.log("Seed complete:", CONTACTS.length, "conversations across X / WhatsApp / Telegram");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
