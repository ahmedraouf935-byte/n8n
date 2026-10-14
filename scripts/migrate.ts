import "./_env";
import { createSql } from "../src/lib/db/client";
import { migrate, type AppEnvironment } from "../src/lib/db/migrate";

const env = (process.env.SAFQA_ENV ?? "production") as AppEnvironment;
const sql = createSql();
migrate(sql, env)
  .then((ran) => {
    console.log(ran.length ? `Applied: ${ran.join(", ")}` : "Database is up to date.");
    console.log(`Environment stamp: ${env}`);
  })
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
