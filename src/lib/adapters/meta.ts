/**
 * Meta Graph API publishing adapter — the owner's OWN Facebook Page and Instagram professional account only.
 * Requires a Page access token with pages_manage_posts (+ instagram_content_publish for IG) granted through
 * a Meta app the owner controls. Instagram requires a publicly reachable image URL and allows
 * a limited number of API-published posts per 24h (check /content_publishing_limit).
 */
const GRAPH = "https://graph.facebook.com/v21.0";

export interface MetaConfig {
  pageId?: string;
  pageToken?: string;
  igUserId?: string;
}
export function metaConfig(): MetaConfig {
  return { pageId: process.env.META_PAGE_ID || undefined, pageToken: process.env.META_PAGE_ACCESS_TOKEN || undefined, igUserId: process.env.META_IG_USER_ID || undefined };
}
export function metaEnabled(platform: "facebook" | "instagram", c = metaConfig()) {
  return platform === "facebook" ? !!(c.pageId && c.pageToken) : !!(c.igUserId && c.pageToken);
}

export class MetaError extends Error {}

async function post(path: string, params: Record<string, string>, token: string) {
  const res = await fetch(`${GRAPH}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, access_token: token }),
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => ({}))) as { id?: string; post_id?: string; error?: { message: string; code: number } };
  if (!res.ok || json.error) throw new MetaError(json.error ? `${json.error.code}: ${json.error.message}` : `HTTP ${res.status}`);
  return json;
}

/** Returns the external post id. Throws MetaError on any failure — callers must record the failure. */
export async function publishToMeta(platform: "facebook" | "instagram", caption: string, imageUrl: string | null, c = metaConfig()): Promise<string> {
  if (!metaEnabled(platform, c)) throw new MetaError(`${platform} publishing is not configured`);
  if (platform === "facebook") {
    const r = imageUrl
      ? await post(`${c.pageId}/photos`, { url: imageUrl, caption }, c.pageToken!)
      : await post(`${c.pageId}/feed`, { message: caption }, c.pageToken!);
    return r.post_id ?? r.id!;
  }
  if (!imageUrl) throw new MetaError("Instagram requires an image");
  const container = await post(`${c.igUserId}/media`, { image_url: imageUrl, caption }, c.pageToken!);
  const published = await post(`${c.igUserId}/media_publish`, { creation_id: container.id! }, c.pageToken!);
  return published.id!;
}
