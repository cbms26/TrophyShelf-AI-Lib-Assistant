// lib/cors.ts
// The mobile app calls /api/chat directly (no CORS involved), but the
// TrophyShelf PWA runs in a browser on another origin, so it needs CORS.
// Only origins in ALLOWED_ORIGINS (comma-separated) get the headers.

const DEFAULT_ORIGINS = "https://trophyshelf.vercel.app";

function allowedOrigins(): string[] {
  return (process.env.ALLOWED_ORIGINS || DEFAULT_ORIGINS)
    .split(",")
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!origin || !allowedOrigins().includes(origin)) return { Vary: "Origin" };
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept, x-trophyshelf-client",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function withCors(req: Request, res: Response): Response {
  for (const [key, value] of Object.entries(corsHeaders(req))) res.headers.set(key, value);
  return res;
}
