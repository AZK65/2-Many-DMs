import { NextRequest, NextResponse } from "next/server";
import { normalizedXPostUrl, xPostTextFromOembed } from "@/lib/x-post-preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const postUrl = normalizedXPostUrl(request.nextUrl.searchParams.get("url") || "");
  if (!postUrl) return NextResponse.json({ error: "Only public X post previews are supported." }, { status: 400 });
  try {
    const endpoint = new URL("https://publish.x.com/oembed");
    endpoint.searchParams.set("url", postUrl);
    endpoint.searchParams.set("omit_script", "true");
    endpoint.searchParams.set("dnt", "true");
    const response = await fetch(endpoint, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`X preview failed (${response.status})`);
    const data = await response.json() as { author_name?: string; author_url?: string; html?: string };
    const text = xPostTextFromOembed(data.html || "");
    if (!text) throw new Error("X did not return post text");
    return NextResponse.json({
      postUrl,
      authorName: data.author_name?.trim() || "X post",
      authorUrl: data.author_url,
      text,
    }, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch {
    return NextResponse.json({ error: "This X post could not be previewed right now." }, { status: 502 });
  }
}
