import bcrypt from "bcryptjs";
import { createSql, type Sql } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";
import type { Actor } from "@/lib/services/audit";

export const TEST_URL = process.env.TEST_DATABASE_URL ?? "postgres://safqa:safqa@localhost:5432/safqa_test";

export async function freshDb(): Promise<{ sql: Sql; owner: Actor & { role: string } }> {
  const sql = createSql(TEST_URL);
  await sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  await migrate(sql, "test");
  const [u] = await sql<{ id: number }[]>`INSERT INTO users (email, name, password_hash, role)
    VALUES ('owner@test.local', 'Owner', ${bcrypt.hashSync("x", 4)}, 'owner') RETURNING id`;
  return { sql, owner: { id: u.id, label: "owner:test", role: "owner" } };
}
