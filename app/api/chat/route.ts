// app/api/chat/route.ts
// POST { messages, shelf } -> the TrophyShelf Librarian's reply, streamed as
// newline-delimited JSON events (see lib/types.ts ChatEvent).
// Validation/guard failures return { ok: false, error } with a 4xx status
// before any streaming starts.

import { NextResponse } from "next/server";
import { guardRequest } from "@/lib/apiGuard";
import { corsHeaders, withCors } from "@/lib/cors";
import { streamReply } from "@/lib/gemini";
import type { ChatEvent, ChatMessage, ShelfBook } from "@/lib/types";

export const maxDuration = 60;

const MAX_BOOKS = 200;
const MAX_MESSAGES = 20;
const MAX_MESSAGE_CHARS = 2000;
const MAX_NOTE_CHARS = 280;

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function parseShelf(raw: unknown): ShelfBook[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_BOOKS)
    .map((b: Record<string, unknown>) => ({
      title: str(b?.title, 200),
      author: str(b?.author, 120),
      genre: str(b?.genre, 60),
      status: b?.status === "reading" ? ("reading" as const) : ("finished" as const),
      finishedAt: typeof b?.finishedAt === "string" ? b.finishedAt.slice(0, 32) : null,
      note: str(b?.note, MAX_NOTE_CHARS),
    }))
    .filter((b) => b.title);
}

function parseMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const msgs = raw
    .map((m: Record<string, unknown>) => ({
      role: m?.role === "model" ? ("model" as const) : ("user" as const),
      text: str(m?.text, MAX_MESSAGE_CHARS),
    }))
    .filter((m) => m.text)
    .slice(-MAX_MESSAGES);
  // Gemini expects the conversation to open with the user.
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  return msgs;
}

// Browser preflight for the PWA (see lib/cors.ts).
export function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export async function POST(req: Request) {
  return withCors(req, await handleChat(req));
}

async function handleChat(req: Request): Promise<Response> {
  const blocked = await guardRequest(req);
  if (blocked) return blocked;

  let messages: ChatMessage[];
  let shelf: ShelfBook[];
  try {
    const body = (await req.json()) as { messages?: unknown; shelf?: unknown };
    messages = parseMessages(body.messages);
    shelf = parseShelf(body.shelf);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return NextResponse.json(
      { ok: false, error: "Last message must be from the user" },
      { status: 400 }
    );
  }
  if (!process.env.GEMINI_API_KEY) {
    console.error("Chat route: GEMINI_API_KEY is not set");
    return NextResponse.json({ ok: false, error: "Server misconfigured" }, { status: 500 });
  }

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: ChatEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        for await (const event of streamReply(messages, shelf)) send(event);
        send({ type: "done" });
      } catch (err) {
        console.error("Chat route error:", err);
        send({ type: "error", error: "The Librarian couldn't answer just now. Please try again." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
