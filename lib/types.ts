// lib/types.ts
// The /api/chat contract shared with the trophyshelf mobile app
// (mirrored in trophyshelf/src/lib/chat.ts — keep the two in sync).

export type ShelfBook = {
  title: string;
  author: string;
  genre: string;
  status: "reading" | "finished";
  finishedAt: string | null;
  note: string;
};

export type ChatMessage = {
  role: "user" | "model";
  text: string;
};

export type ChatRequest = {
  messages: ChatMessage[];
  shelf: ShelfBook[];
};

export type Recommendation = {
  title: string;
  authors: string[];
  thumbnail: string | null;
  infoLink: string | null;
  isbn: string | null;
};

// Streamed response: one JSON object per line (application/x-ndjson).
export type ChatEvent =
  | { type: "text"; text: string }
  | { type: "recommendations"; items: Recommendation[] }
  | { type: "done" }
  | { type: "error"; error: string };
