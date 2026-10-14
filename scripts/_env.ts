import fs from "node:fs";
// Load .env for CLI scripts (Next.js loads it automatically for the app).
if (fs.existsSync(".env")) process.loadEnvFile(".env");
