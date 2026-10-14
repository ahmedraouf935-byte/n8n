import type { Db } from "../db/client";

export interface Actor {
  id: number | null;     // null for system/n8n
  label: string;         // "owner:ahmed", "n8n", "system"
}
export const SYSTEM: Actor = { id: null, label: "system" };

export async function audit(
  db: Db, actor: Actor, action: string, entityType: string, entityId: number | null, before: unknown, after: unknown,
) {
  await db`INSERT INTO audit_logs (actor_id, actor_label, action, entity_type, entity_id, before, after)
           VALUES (${actor.id}, ${actor.label}, ${action}, ${entityType}, ${entityId},
                   ${before === null || before === undefined ? null : db.json(before as never)},
                   ${after === null || after === undefined ? null : db.json(after as never)})`;
}
