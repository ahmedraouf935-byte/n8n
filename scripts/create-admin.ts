import "./_env";
import bcrypt from "bcryptjs";
import readline from "node:readline/promises";
import { createSql } from "../src/lib/db/client";

/**
 * Creates (or resets the password of) the owner account.
 * Usage: npm run db:create-admin -- owner@example.com "Owner Name"
 * The password is read from SAFQA_ADMIN_PASSWORD or prompted (never passed on the command line).
 */
async function main() {
  const [email, name = "المالك"] = process.argv.slice(2);
  if (!email) throw new Error('Usage: npm run db:create-admin -- <email> "<name>"');
  let password = process.env.SAFQA_ADMIN_PASSWORD;
  if (!password) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    password = await rl.question("Password (min 12 chars): ");
    rl.close();
  }
  if (!password || password.length < 12) throw new Error("Password must be at least 12 characters");
  const sql = createSql();
  try {
    const hash = await bcrypt.hash(password, 12);
    const [u] = await sql<{ id: number }[]>`
      INSERT INTO users (email, name, password_hash, role) VALUES (${email}, ${name}, ${hash}, 'owner')
      ON CONFLICT (lower(email)) DO UPDATE SET password_hash = EXCLUDED.password_hash, name = EXCLUDED.name, role = 'owner', is_active = true
      RETURNING id`;
    console.log(`Owner account ready (id ${u.id}): ${email}`);
  } finally {
    await sql.end();
  }
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
