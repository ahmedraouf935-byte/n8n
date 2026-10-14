import { machineRoute } from "@/lib/auth/apiAuth";
import { getSql } from "@/lib/db/client";
import { getDatabaseEnvironment } from "@/lib/db/migrate";

export const dynamic = "force-dynamic";

export const GET = machineRoute(async () => {
  const sql = getSql();
  const integrations = await sql`SELECT code, status, last_error FROM integration_status ORDER BY code`;
  return { environment: await getDatabaseEnvironment(sql), integrations };
});
