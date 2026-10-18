# TrophyShelf Librarian

Chat backend for the floating **Librarian** assistant in the
[TrophyShelf](https://github.com/cbms26/trophyshelf) mobile app. It answers
questions about the books a reader has enshrined and recommends similar,
real books.

- **Gemini API** (`gemini-3.5-flash`) via `@google/genai`: conversation,
  on-topic guardrails, function calling.
- **Google Books API**: the `search_books` tool. Every recommendation comes
  from a real Books result (cover, ISBN, link), never an invented title.
- **Upstash** per-IP rate limits (20/min, 200/day) + body cap + client header
  (`lib/apiGuard.ts`, adapted from the TrophyShelf web app).

The UI (bubble, chat sheet, on-device history) lives in the app repo:
`src/components/ChatBubble.tsx`, `src/components/ChatSheet.tsx`,
`src/store/ChatContext.tsx`, `src/lib/chat.ts`.

## API contract

`POST /api/chat` with header `x-trophyshelf-client: mobile/<version>`:

```json
{
  "messages": [{ "role": "user", "text": "Recommend something like Dune" }],
  "shelf": [
    { "title": "Dune", "author": "Frank Herbert", "genre": "Science Fiction",
      "status": "finished", "finishedAt": "2026-06-11", "note": "" }
  ]
}
```

Limits: 200 books, last 20 messages, 2000 chars per message, 280 chars per note.

**Success**: `200`, `Content-Type: application/x-ndjson`, one JSON event per line:

```
{"type":"text","text":"Since you loved Dune…"}
{"type":"recommendations","items":[{"title":"…","authors":["…"],"thumbnail":"https://…","infoLink":"https://…","isbn":"…"}]}
{"type":"done"}
```

A failure mid-stream sends `{"type":"error","error":"…"}` instead of `done`.

**Rejected before streaming**: `{ "ok": false, "error": "…" }` with 400 / 403 / 413 / 429 (`Retry-After`) / 500.

Types: `lib/types.ts` (mirrored in the app's `src/lib/chat.ts`; keep them in sync).

## Local development

```bash
cp .env.example .env.local   # fill in the keys
npm install
npm run dev -- -p 3100
```

Point the app at it: `EXPO_PUBLIC_LIBRARIAN_API_URL=http://<your-LAN-IP>:3100 npx expo start`.

Smoke test:

```bash
curl -N -X POST http://localhost:3100/api/chat \
  -H 'Content-Type: application/json' -H 'x-trophyshelf-client: mobile/1.0' \
  -d '{"messages":[{"role":"user","text":"What should I read next?"}],"shelf":[{"title":"Project Hail Mary","author":"Andy Weir","genre":"Science Fiction","status":"finished","finishedAt":"2026-03-02","note":""}]}'
```

## Environment

| Variable | Required | Notes |
|---|---|---|
| `GEMINI_API_KEY` | yes | Google AI Studio key |
| `GEMINI_MODEL` | no | defaults to `gemini-3.5-flash` |
| `GOOGLE_BOOKS_API_KEY` | yes (prod) | Google Cloud key restricted to the Books API. The keyless shared quota is routinely exhausted. |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | yes (prod) | unset = rate limiting disabled |

## Deploy

1. Push this repo to GitHub (`trophyshelf-librarian`).
2. Import it as a new Vercel project; add the env vars above.
3. The app's default `LIBRARIAN_API_URL` is `https://trophyshelf-librarian.vercel.app`;
   change it in the app's `src/config.ts` if your Vercel URL differs.
