// lib/apiGuard.ts (adapted from trophyshelf/legacy-web/lib/apiGuard.ts)
// Cheap protections for the public chat route, applied before any body is
// parsed: client header (speed bump), Content-Length cap, and per-IP rate
// limiting via Upstash. Returns a NextResponse to send back, or null to let
// the handler proceed.

import { NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const MAX_BODY_BYTES = 256 * 1024;
const CLIENT_HEADER = "x-trophyshelf-client";
const CLIENT_PATTERN = /^(mobile|web)\/\d+(\.\d+)*$/;

let limiters: { minute: Ratelimit; day: Ratelimit } | null | undefined;

function getLimiters() {
  if (limiters !== undefined) return limiters;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    console.warn(
      "apiGuard: UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set — rate limiting is DISABLED"
    );
    limiters = null;
    return limiters;
  }

  const redis = new Redis({ url, token });
  limiters = {
    minute: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(20, "1 m"),
      prefix: "librarian:rl:minute",
    }),
    day: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(200, "1 d"),
      prefix: "librarian:rl:day",
    }),
  };
  return limiters;
}

function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function guardRequest(req: Request): Promise<NextResponse | null> {
  const client = req.headers.get(CLIENT_HEADER);
  if (!client || !CLIENT_PATTERN.test(client)) {
    return NextResponse.json(
      { ok: false, error: "Unsupported client" },
      { status: 403 }
    );
  }

  const length = Number(req.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
    return NextResponse.json(
      { ok: false, error: "Request too large" },
      { status: 413 }
    );
  }

  const rl = getLimiters();
  if (rl) {
    const ip = clientIp(req);
    const [minute, day] = await Promise.all([
      rl.minute.limit(ip),
      rl.day.limit(ip),
    ]);
    if (!minute.success || !day.success) {
      const failed = [minute, day].filter((r) => !r.success);
      const resetAt = Math.max(...failed.map((r) => r.reset));
      const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
      return NextResponse.json(
        { ok: false, error: "Too many requests. Try again shortly." },
        { status: 429, headers: { "Retry-After": String(retryAfter) } }
      );
    }
  }

  return null;
}
