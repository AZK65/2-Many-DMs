import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import { emailsIn } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ExportRow = {
  email: string;
  contactName: string;
  handle: string;
  platform: string;
  sourceApp: string;
  firstSeen: Date;
  lastActivity: Date;
  waitHours: number;
  waitBucket: string;
  copyCount: number;
  tracked: boolean;
  conversationId: string;
  sourceMessageId: string;
  sourceMessage: string;
};

function bucket(hours: number, tracked: boolean): string {
  if (!tracked) return "Discovered only";
  if (hours < 24) return "New";
  if (hours < 72) return "Waiting";
  return "Old";
}

export async function GET(req: NextRequest) {
  const captures = await prisma.emailCapture.findMany({
    orderBy: { copiedAt: "desc" },
    include: {
      contact: { select: { name: true, handle: true } },
      conversation: { select: { platform: true } },
      message: { select: { body: true, createdAt: true } },
    },
  });
  const historical = await prisma.message.findMany({
    where: { body: { contains: "@" } },
    orderBy: { createdAt: "desc" },
    take: 2500,
    include: {
      conversation: {
        select: {
          id: true,
          platform: true,
          contact: { select: { name: true, handle: true } },
        },
      },
    },
  });

  const rows = new Map<string, ExportRow>();
  for (const message of historical) {
    for (const email of emailsIn(message.body)) {
      if (rows.has(email)) continue;
      rows.set(email, {
        email,
        contactName: message.conversation.contact.name,
        handle: message.conversation.contact.handle,
        platform: message.conversation.platform,
        sourceApp: "",
        firstSeen: message.createdAt,
        lastActivity: message.createdAt,
        waitHours: 0,
        waitBucket: "Discovered only",
        copyCount: 0,
        tracked: false,
        conversationId: message.conversation.id,
        sourceMessageId: message.id,
        sourceMessage: message.body,
      });
    }
  }

  const grouped = new Map<string, typeof captures>();
  for (const capture of captures) {
    const list = grouped.get(capture.email) || [];
    list.push(capture);
    grouped.set(capture.email, list);
  }
  for (const [email, items] of grouped) {
    const latest = items.reduce((a, b) => a.copiedAt > b.copiedAt ? a : b);
    const firstSeen = new Date(Math.min(...items.map((item) => item.firstCopiedAt.getTime())));
    const lastActivity = new Date(Math.max(...items.map((item) => item.copiedAt.getTime())));
    const waitHours = Math.max(0, Math.floor((Date.now() - firstSeen.getTime()) / 3_600_000));
    rows.set(email, {
      email,
      contactName: latest.contact.name,
      handle: latest.contact.handle,
      platform: latest.conversation.platform,
      sourceApp: latest.sourceApp || "OmniCRM",
      firstSeen,
      lastActivity,
      waitHours,
      waitBucket: bucket(waitHours, true),
      copyCount: items.reduce((sum, item) => sum + item.copyCount, 0),
      tracked: true,
      conversationId: latest.conversationId,
      sourceMessageId: latest.messageId,
      sourceMessage: latest.message.body,
    });
  }

  const data = [...rows.values()].sort((a, b) => {
    if (a.tracked !== b.tracked) return a.tracked ? -1 : 1;
    return a.firstSeen.getTime() - b.firstSeen.getTime();
  });
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "OmniCRM";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Email leads", {
    views: [{ state: "frozen", ySplit: 1 }],
    properties: { defaultRowHeight: 20 },
    pageSetup: {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      paperSize: 9,
      margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    },
  });
  sheet.columns = [
    { header: "Email", key: "email", width: 34 },
    { header: "Client", key: "contactName", width: 24 },
    { header: "Handle", key: "handle", width: 22 },
    { header: "Platform", key: "platform", width: 13 },
    { header: "Status", key: "waitBucket", width: 17 },
    { header: "First copied / found", key: "firstSeen", width: 22 },
    { header: "Last activity", key: "lastActivity", width: 22 },
    { header: "Wait hours", key: "waitHours", width: 12 },
    { header: "Copy count", key: "copyCount", width: 12 },
    { header: "Source app", key: "sourceApp", width: 20 },
    { header: "Conversation ID", key: "conversationId", width: 28 },
    { header: "Message ID", key: "sourceMessageId", width: 28 },
    { header: "Source message", key: "sourceMessage", width: 60 },
  ];
  data.forEach((row) => sheet.addRow(row));
  sheet.autoFilter = { from: "A1", to: "M1" };
  const header = sheet.getRow(1);
  header.height = 26;
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF181818" } };
  header.alignment = { vertical: "middle" };
  sheet.getColumn("firstSeen").numFmt = "yyyy-mm-dd hh:mm";
  sheet.getColumn("lastActivity").numFmt = "yyyy-mm-dd hh:mm";
  sheet.getColumn("waitHours").numFmt = "#,##0";
  sheet.getColumn("copyCount").numFmt = "#,##0";
  sheet.getColumn("sourceMessage").alignment = { wrapText: true, vertical: "top" };
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    row.alignment = { vertical: "top" };
    if (index % 2 === 0)
      row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(Buffer.from(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="omnicrm-emails-${date}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
