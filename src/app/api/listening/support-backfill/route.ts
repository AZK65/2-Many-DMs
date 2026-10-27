import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function listenerUrl() {
  const base = process.env.LISTENING_URL;
  return base ? `${base.replace(/\/$/, "")}/api/support/backfill` : null;
}

function authHeaders(): Record<string, string> {
  const key = process.env.LISTENING_CONFIG_KEY;
  return key ? { Authorization: `Bearer ${key}` } : {};
}

async function proxy(method: "GET" | "POST") {
  const url = listenerUrl();
  if (!url) {
    return NextResponse.json({ error: "The social listener is not configured." }, { status: 503 });
  }

  try {
    const response = await fetch(url, {
      method,
      headers: authHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const text = await response.text();
    let data: unknown = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { error: "The social listener returned an invalid response." };
    }
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      { error: `The social listener is unavailable: ${(error as Error).message}` },
      { status: 502 }
    );
  }
}

export async function GET() {
  return proxy("GET");
}

export async function POST(_request: NextRequest) {
  return proxy("POST");
}
