import { supabase } from "@/integrations/supabase/client";

export type Bucket = "source-videos" | "generated-images" | "generated-videos";

type CacheEntry = { url: string; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 1000 * 60 * 55;
const SIGN_SECONDS = 60 * 60 * 24 * 7;

const keyOf = (bucket: Bucket, path: string) => `${bucket}::${path}`;

export async function batchSignedUrls(
  bucket: Bucket,
  paths: Array<string | null | undefined>,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const now = Date.now();
  const toSign: string[] = [];

  for (const p of paths) {
    if (!p) continue;
    const hit = cache.get(keyOf(bucket, p));
    if (hit && hit.expiresAt > now) out[p] = hit.url;
    else toSign.push(p);
  }
  if (toSign.length === 0) return out;

  const { data, error } = await supabase.storage.from(bucket).createSignedUrls(toSign, SIGN_SECONDS);
  if (error || !data) return out;
  for (const row of data) {
    if (!row.path || !row.signedUrl) continue;
    cache.set(keyOf(bucket, row.path), { url: row.signedUrl, expiresAt: now + TTL_MS });
    out[row.path] = row.signedUrl;
  }
  return out;
}

export function videoPosterUrl(url: string): string {
  return url.includes("#") ? url : `${url}#t=0.1`;
}
