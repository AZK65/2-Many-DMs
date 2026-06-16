import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await req.json();
  const data: {
    name?: string;
    notes?: string;
    company?: string;
    email?: string;
    phone?: string;
    stage?: string | null;
  } = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (typeof body.notes === "string") data.notes = body.notes;
  if (typeof body.company === "string") data.company = body.company;
  if (typeof body.email === "string") data.email = body.email;
  if (typeof body.phone === "string") data.phone = body.phone;
  // Stages are user-editable now, so accept any stage id (or null to clear).
  if (body.stage === null) data.stage = null;
  else if (typeof body.stage === "string" && body.stage.trim())
    data.stage = body.stage.trim();

  const contact = await prisma.contact.update({
    where: { id: params.id },
    data,
  });

  return NextResponse.json(contact);
}
