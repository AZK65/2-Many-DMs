import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PREFIX = "SaaS inbox · ";

const rules = [
  {
    name: `${PREFIX}Route support`,
    trigger: "keyword",
    keyword:
      "help, issue, error, bug, broken, not working, can't login, cannot login, problem, troubleshoot",
    intent: "normal",
    actions: [{ id: "intent-support", type: "intent", intent: "support" }],
    schedule: "instant",
    cooldownDays: 0,
  },
  {
    name: `${PREFIX}Route onboarding`,
    trigger: "keyword",
    keyword:
      "onboard, onboarding, setup, set up, get started, connect account, integration, invite team, import",
    intent: "normal",
    actions: [{ id: "intent-onboarding", type: "intent", intent: "onboarding" }],
    schedule: "instant",
    cooldownDays: 0,
  },
  {
    name: `${PREFIX}Route prospects`,
    trigger: "keyword",
    keyword:
      "pricing, price, plan, trial, demo, interested, sign up, signup, subscription, how much, features",
    intent: "normal",
    actions: [{ id: "intent-prospect", type: "intent", intent: "prospect" }],
    schedule: "instant",
    cooldownDays: 0,
  },
  {
    name: `${PREFIX}Prospect follow-up`,
    trigger: "no_reply",
    noReplyDays: 2,
    intent: "prospect",
    actions: [{ id: "follow-up-prospect", type: "follow_up", days: 0 }],
    schedule: "daily",
    cooldownDays: 1,
  },
  {
    name: `${PREFIX}Overdue support`,
    trigger: "unanswered",
    noReplyDays: 1,
    intent: "support",
    actions: [{ id: "follow-up-support", type: "follow_up", days: 0 }],
    schedule: "daily",
    cooldownDays: 1,
  },
  {
    name: `${PREFIX}Overdue onboarding`,
    trigger: "unanswered",
    noReplyDays: 1,
    intent: "onboarding",
    actions: [{ id: "follow-up-onboarding", type: "follow_up", days: 0 }],
    schedule: "daily",
    cooldownDays: 1,
  },
];

export async function POST() {
  let created = 0;
  for (const rule of rules) {
    const existing = await prisma.automation.findFirst({
      where: { name: rule.name },
    });
    if (existing) continue;
    await prisma.automation.create({
      data: {
        name: rule.name,
        enabled: true,
        trigger: rule.trigger,
        keyword: rule.keyword ?? null,
        noReplyDays: rule.noReplyDays ?? null,
        intent: rule.intent,
        message: "",
        actions: JSON.stringify(rule.actions),
        schedule: rule.schedule,
        cooldownDays: rule.cooldownDays,
      },
    });
    created++;
  }
  return NextResponse.json({ ok: true, created, total: rules.length });
}
