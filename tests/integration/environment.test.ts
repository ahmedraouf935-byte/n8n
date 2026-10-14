import { describe, expect, it } from "vitest";
import { createSql } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";
import { TEST_URL } from "./helpers";
import { assertDemoDatabase } from "../../scripts/seed-guard";

describe("[AC15] demo data cannot appear as verified production data", () => {
  it("a database stamped for one environment refuses another", async () => {
    const sql = createSql(TEST_URL);
    await sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
    await migrate(sql, "demo");
    await expect(migrate(sql, "production")).rejects.toThrow(/stamped as 'demo'/);
    await sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
    await migrate(sql, "production");
    await expect(assertDemoDatabase(sql)).rejects.toThrow(/demo/);
    await sql.end();
  });
});
