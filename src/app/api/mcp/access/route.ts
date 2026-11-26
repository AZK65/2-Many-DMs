import { z } from "zod";
import { prisma } from "@/lib/db";
import { agentAccessStore, mcpRequestAllowed } from "@/lib/mcp-access";
import { MCP_PLATFORMS } from "@/lib/mcp-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
async function manage(request: Request) {
  if (!mcpRequestAllowed(request, true))
    return reply(
      { error: "Manage agent access from the app on this computer." },
      403,
    );
  try {
    const store = agentAccessStore();
    if (request.method === "GET") {
      const accounts = await prisma.account.findMany({
        where: { platform: { in: [...MCP_PLATFORMS] } },
        select: { id: true, platform: true, label: true },
      });
      return reply({
        keys: store.list(),
        accounts,
        endpointPath: "/api/mcp",
        remoteUrl: process.env.MCP_PUBLIC_URL || null,
      });
    }
    // Do not accept arbitrarily large management payloads either.
    const body = await request.text();
    if (body.length > 16_384)
      return reply({ error: "Request too large." }, 413);
    const input = JSON.parse(body);
    if (request.method === "DELETE") {
      const parsed = z.object({ id: z.string().uuid() }).strict().parse(input);
      store.revoke(parsed.id);
      return reply({ keys: store.list() });
    }
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(60),
        accountIds: z.array(z.string().min(1).max(120)).min(1).max(100),
      })
      .strict()
      .parse(input);
    const accounts = await prisma.account.findMany({
      where: {
        id: { in: parsed.accountIds },
        platform: { in: [...MCP_PLATFORMS] },
      },
      select: { id: true },
    });
    if (accounts.length !== new Set(parsed.accountIds).size)
      return reply(
        {
          error: "One of those accounts is unavailable. Refresh and try again.",
        },
        400,
      );
    return reply(store.create(parsed.name, parsed.accountIds), 201);
  } catch (error) {
    return reply(
      {
        error:
          error instanceof z.ZodError || error instanceof SyntaxError
            ? "Enter a name and choose valid accounts."
            : "Agent access could not be saved. Refresh and try again.",
      },
      400,
    );
  }
}
export const GET = manage;
export const POST = manage;
export const DELETE = manage;
