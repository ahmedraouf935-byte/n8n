import { z } from "zod";
import { machineRoute, N8N_ACTOR } from "@/lib/auth/apiAuth";
import { getSql } from "@/lib/db/client";
import { updateToSupplierPost } from "@/lib/adapters/telegram";
import { ingestTelegramPosts } from "@/lib/services/suppliers";

const Body = z.object({
  idempotencyKey: z.string().max(200).optional(),
  posts: z.array(z.unknown()).max(200).optional(),          // normalized posts
  updates: z.array(z.record(z.string(), z.unknown())).max(200).optional(),   // raw Telegram Update objects (from n8n Telegram Trigger)
});

/** n8n Telegram Trigger → SAFQA. Only chats registered on a supplier are accepted. */
export const POST = machineRoute(async (req) => {
  const b = Body.parse(await req.json());
  const posts = [...(b.posts ?? []), ...(b.updates ?? []).map(updateToSupplierPost).filter(Boolean)];
  return ingestTelegramPosts(getSql(), N8N_ACTOR, posts, b.idempotencyKey);
});
