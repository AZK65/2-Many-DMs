import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await req.json();
  const data: { notes?: string; company?: string } = {};
  if (typeof body.notes === "string") data.notes = body.notes;
  if (typeof body.company === "string") data.company = body.company;

  const contact = await prisma.contact.update({
    where: { id: params.id },
    data,
  });

  return NextResponse.json(contact);
}
