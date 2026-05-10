// npm install --save-dev prisma dotenv
import { config } from "dotenv";
import { resolve } from "node:path";
import { defineConfig } from "prisma/config";

// Load from project root (host: use port 5433 — see docker-compose.yml `5433:5432`).
// quiet: avoids dotenv v17 "◇ injected env…" / dotenvx tips on stderr (Railway logs them as errors).
config({ path: resolve(process.cwd(), ".env"), quiet: true });
config({ path: resolve(process.cwd(), ".env.local"), override: true, quiet: true });

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (url) return url;

  // `prisma generate` loads this config but does not open a DB connection; allow CI / postinstall
  // without a real URL. Migrations and other commands still require DATABASE_URL in .env.
  const isGenerateOnly = process.argv.some((arg) => arg === "generate");
  if (isGenerateOnly) {
    return "postgresql://dummy:dummy@localhost:5432/dummy";
  }

  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env and set DATABASE_URL. " +
      "For Postgres exposed by Docker Compose on this repo, the host port is 5433 " +
      '(e.g. postgresql://fitnexus_user:YOUR_PASSWORD@localhost:5433/fitnexus_db — match POSTGRES_* in .env).'
  );
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx --tsconfig tsconfig.json prisma/seed.ts",
  },
  datasource: {
    url: getDatabaseUrl(),
  },
});
