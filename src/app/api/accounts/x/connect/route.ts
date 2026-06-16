import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { consumePairCode } from "@/lib/pairing";
import { assignProxy } from "@/lib/proxy-assign";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The extension posts here cross-origin, so allow it (and answer preflight).
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function OPTIONS() {
  return new NextResponse(null, { headers: CORS });
}

const X_BEARER =
  "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

// Derive the @handle from the cookies so each X account is a distinct, named
// row (lets you connect several). Falls back to a short token hash.
async function xHandle(authToken: string, ct0: string): Promise<string> {
  try {
    const res = await fetch(
      "https://x.com/i/api/1.1/dm/inbox_initial_state.json?dm_users=true",
      {
        headers: {
          authorization: X_BEARER,
          "x-csrf-token": ct0,
          "x-twitter-auth-type": "OAuth2Session",
          "x-twitter-active-user": "yes",
          cookie: `auth_token=${authToken}; ct0=${ct0}`,
        },
      }
    );
    if (res.ok) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const st = ((await res.json()) as any).inbox_initial_state || {};
      const freq = new Map<string, number>();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const c of Object.values<any>(st.conversations || {})) {
        if (c?.type && c.type !== "ONE_TO_ONE") continue;
        const ps = Array.isArray(c?.participants)
          ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
            c.participants.map((p: any) => String(p.user_id))
          : [];
        for (const id of ps) freq.set(id, (freq.get(id) || 0) + 1);
      }
      let me = "";
      let best = -1;
      for (const [id, n] of freq) if (n > best) { best = n; me = id; }
      const sn = (st.users || {})[me]?.screen_name;
      if (sn) return "@" + sn;
    }
  } catch {
    /* fall through to hash */
  }
  return "X · " + authToken.slice(-6);
}

// Receives the user's X session cookies from the browser extension, verified by
// the one-time pairing code, and stores them encrypted on an X Account.
export async function POST(req: NextRequest) {
  const { code, authToken, ct0 } = await req.json().catch(() => ({}));

  const userId = consumePairCode(String(code || ""));
  if (!userId) {
    return NextResponse.json(
      { error: "Invalid or expired pairing code. Get a fresh one in the app." },
      { status: 401, headers: CORS }
    );
  }
  if (!authToken || !ct0) {
    return NextResponse.json(
      { error: "Missing X session cookies." },
      { status: 400, headers: CORS }
    );
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return NextResponse.json(
      { error: "Account not found." },
      { status: 404, headers: CORS }
    );
  }

  const proxy = await assignProxy(user).catch(() => null);
  const session = encrypt(JSON.stringify({ authToken, ct0 }));
  const label = await xHandle(String(authToken), String(ct0));

  const account = await prisma.account.upsert({
    where: {
      userId_platform_label: {
        userId: user.id,
        platform: "x",
        label,
      },
    },
    create: {
      userId: user.id,
      platform: "x",
      label,
      status: "connected",
      session,
      proxyId: proxy?.id,
    },
    update: {
      status: "connected",
      session,
      proxyId: proxy?.id ?? undefined,
      detail: null,
    },
  });

  return NextResponse.json(
    { ok: true, accountId: account.id, proxyRegion: proxy?.region ?? null },
    { headers: CORS }
  );
}
