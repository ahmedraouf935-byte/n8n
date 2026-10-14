import type { Sql } from "../src/lib/db/client";
import { getDatabaseEnvironment } from "../src/lib/db/migrate";

/** Demo seed data may only ever be written to a database stamped as 'demo'. */
export async function assertDemoDatabase(sql: Sql) {
  const env = await getDatabaseEnvironment(sql);
  if (env !== "demo") throw new Error(`Refusing to seed: database environment is '${env}', not 'demo'.`);
}
