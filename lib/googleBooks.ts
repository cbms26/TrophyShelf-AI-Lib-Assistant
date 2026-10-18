// lib/googleBooks.ts
// Google Books lookup backing the `search_books` tool, so every
// recommendation is a real volume with a cover and a link — never a
// title the model made up.

import type { Recommendation, ShelfBook } from "./types";

const ENDPOINT = "https://www.googleapis.com/books/v1/volumes";
const TIMEOUT_MS = 8000;

export type BookHit = Recommendation & {
  categories: string[];
  description: string;
  publishedDate: string | null;
  averageRating: number | null;
};

type VolumeItem = {
  volumeInfo?: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    categories?: string[];
    description?: string;
    publishedDate?: string;
    averageRating?: number;
    infoLink?: string;
    imageLinks?: { thumbnail?: string; smallThumbnail?: string };
    industryIdentifiers?: { type: string; identifier: string }[];
  };
};

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[:(].*$/, "") // drop subtitles / series suffixes
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Field operators (inauthor:, intitle:, subject:) sometimes return zero
// results from the Books API even for well-known authors; plain keywords
// are far more reliable.
function stripOperators(query: string): string {
  return query
    .replace(/\b(inauthor|intitle|subject|inpublisher|isbn):/gi, "")
    .replace(/["']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function searchBooks(
  query: string,
  shelf: ShelfBook[],
  maxResults = 6
): Promise<BookHit[]> {
  const hits = await searchOnce(query, shelf, maxResults);
  const plain = stripOperators(query);
  if (hits.length === 0 && plain && plain !== query) {
    return searchOnce(plain, shelf, maxResults);
  }
  return hits;
}

async function searchOnce(
  query: string,
  shelf: ShelfBook[],
  maxResults: number
): Promise<BookHit[]> {
  const params = new URLSearchParams({
    q: query,
    maxResults: String(Math.min(Math.max(maxResults, 1), 10) + 4), // headroom for dedupe
    printType: "books",
    orderBy: "relevance",
  });
  const key = process.env.GOOGLE_BOOKS_API_KEY;
  if (key) params.set("key", key);

  const res = await fetch(`${ENDPOINT}?${params}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    console.error("Google Books error:", res.status, await res.text());
    throw new Error(`Google Books returned ${res.status}`);
  }

  const data = (await res.json()) as { items?: VolumeItem[] };
  const owned = new Set(shelf.map((b) => normalizeTitle(b.title)));
  const seen = new Set<string>();
  const hits: BookHit[] = [];

  for (const item of data.items ?? []) {
    const v = item.volumeInfo;
    if (!v?.title) continue;
    const key = normalizeTitle(v.title);
    if (!key || owned.has(key) || seen.has(key)) continue;
    seen.add(key);

    const ids = v.industryIdentifiers ?? [];
    const isbn =
      ids.find((i) => i.type === "ISBN_13")?.identifier ??
      ids.find((i) => i.type === "ISBN_10")?.identifier ??
      null;
    const thumb = v.imageLinks?.thumbnail ?? v.imageLinks?.smallThumbnail ?? null;

    hits.push({
      title: v.subtitle ? `${v.title}: ${v.subtitle}` : v.title,
      authors: v.authors ?? [],
      categories: v.categories ?? [],
      description: (v.description ?? "").slice(0, 300),
      publishedDate: v.publishedDate ?? null,
      averageRating: v.averageRating ?? null,
      // Books API still hands out http:// thumbnails; iOS ATS blocks those.
      thumbnail: thumb ? thumb.replace(/^http:\/\//, "https://") : null,
      infoLink: v.infoLink ?? null,
      isbn,
    });
    if (hits.length >= maxResults) break;
  }
  return hits;
}
