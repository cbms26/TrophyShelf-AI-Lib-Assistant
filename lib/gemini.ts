// lib/gemini.ts
// Streams one Librarian reply: Gemini may call `search_books` (Google Books)
// a few times before answering. Every model part — including thought
// signatures attached to function calls — is replayed verbatim on the next
// round, which Gemini 3 models require for multi-step function calling.

import {
  GoogleGenAI,
  HarmBlockThreshold,
  HarmCategory,
  ThinkingLevel,
  Type,
  type Content,
  type FunctionDeclaration,
  type Part,
} from "@google/genai";
import { normalizeTitle, searchBooks, type BookHit } from "./googleBooks";
import { buildSystemInstruction } from "./prompt";
import type { ChatEvent, ChatMessage, Recommendation, ShelfBook } from "./types";

const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";
const MAX_TOOL_ROUNDS = 3;

const searchBooksTool: FunctionDeclaration = {
  name: "search_books",
  description:
    "Search Google Books for real books to recommend. Books already on the reader's shelf are filtered out automatically. Use plain keywords — an author name ('ursula k le guin'), a genre plus theme ('space survival science fiction'), or a similar title. Avoid search operators like inauthor: or intitle:.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: { type: Type.STRING, description: "Google Books search query." },
      maxResults: { type: Type.INTEGER, description: "1-10, default 6." },
    },
    required: ["query"],
  },
};

const safetySettings = [
  HarmCategory.HARM_CATEGORY_HARASSMENT,
  HarmCategory.HARM_CATEGORY_HATE_SPEECH,
  HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
  HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
].map((category) => ({ category, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE }));

let client: GoogleGenAI | null = null;
function ai(): GoogleGenAI {
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

export async function* streamReply(
  messages: ChatMessage[],
  shelf: ShelfBook[]
): AsyncGenerator<ChatEvent> {
  const contents: Content[] = messages.map((m) => ({
    role: m.role,
    parts: [{ text: m.text }],
  }));
  const config = {
    systemInstruction: buildSystemInstruction(shelf, new Date().toISOString().slice(0, 10)),
    tools: [{ functionDeclarations: [searchBooksTool] }],
    safetySettings,
    maxOutputTokens: 1024,
    thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
  };

  const found = new Map<string, BookHit>(); // every book the tool returned
  let reply = "";

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    // Last round: drop the tool so the model has to answer with what it has.
    const roundConfig = round === MAX_TOOL_ROUNDS ? { ...config, tools: undefined } : config;
    const stream = await ai().models.generateContentStream({
      model: MODEL,
      contents,
      config: roundConfig,
    });

    const modelParts: Part[] = [];
    for await (const chunk of stream) {
      for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
        modelParts.push(part);
        if (part.text && !part.thought) {
          reply += part.text;
          yield { type: "text", text: part.text };
        }
      }
    }

    const calls = modelParts.filter((p) => p.functionCall);
    if (calls.length === 0) break;

    contents.push({ role: "model", parts: modelParts });
    const responses: Part[] = [];
    for (const { functionCall } of calls) {
      const args = (functionCall!.args ?? {}) as { query?: string; maxResults?: number };
      let response: Record<string, unknown>;
      if (functionCall!.name !== "search_books" || !args.query) {
        response = { error: "Unknown tool or missing query" };
      } else {
        try {
          const hits = await searchBooks(args.query, shelf, args.maxResults ?? 6);
          hits.forEach((h) => found.set(normalizeTitle(h.title), h));
          response = { results: hits };
        } catch (err) {
          response = { error: err instanceof Error ? err.message : "Search failed" };
        }
      }
      responses.push({
        functionResponse: { id: functionCall!.id, name: functionCall!.name, response },
      });
    }
    contents.push({ role: "user", parts: responses });
  }

  // Cards only for books the final answer actually names.
  const lowerReply = reply.toLowerCase();
  const items: Recommendation[] = [...found.values()]
    .filter((h) => lowerReply.includes(h.title.split(":")[0].toLowerCase().trim()))
    .slice(0, 4)
    .map(({ title, authors, thumbnail, infoLink, isbn }) => ({
      title,
      authors,
      thumbnail,
      infoLink,
      isbn,
    }));
  if (items.length) yield { type: "recommendations", items };
}
