# Deploying SAFQA (go-live checklist)

Recommended low-cost setup: **Neon Postgres (free, persistent) + Vercel**. Both deploy straight from this public GitHub repository. Its default branch is `claude/safqa-commerce-platform-v5qi7o`.

> ⚠️ **Plan choice (needs your decision):** Vercel's free *Hobby* plan is for non-commercial use, and SAFQA runs a business. Two options:
> - **A. Vercel Pro** (~$20/month), or
> - **B. Render "Starter" web service** (~$7/month) with the same Neon database.
>
> You can try the dashboard on Hobby first and switch plans before real use. Nothing in SAFQA turns on a paid service by itself.

## Step 1 — Database (Neon, free tier)
1. Sign in at https://console.neon.tech and create a project. Pick the region **AWS Europe (Frankfurt) `eu-central-1`**, the closest to Egypt.
2. Copy two connection strings from **Connection Details**:
   - **Pooled** (the host contains `-pooler`) → `DATABASE_URL`
   - **Direct** (no `-pooler`) → `MIGRATION_DATABASE_URL`

   Both must end with `?sslmode=require`.
3. Turn on Neon's point-in-time restore if your plan offers it. Also keep the weekly `pg_dump` backup described in README.

## Step 2 — Generate secrets (on your computer)
```bash
openssl rand -base64 48   # SESSION_SECRET
openssl rand -hex 24      # N8N_WEBHOOK_SECRET
openssl rand -hex 16      # SAFQA_SETUP_TOKEN (one-time owner setup)
```

## Step 3 — Deploy the app (Vercel)
1. Go to https://vercel.com/new, choose **Import Git Repository**, then `ahmedraouf935-byte/n8n`.
2. Framework: Next.js (auto-detected). Build command: `npm run vercel-build` (comes from `vercel.json`). Region: Frankfurt (`fra1`).
3. Add these **Environment Variables** for *Production*:

| Name | Value |
|---|---|
| `DATABASE_URL` | Neon **pooled** URL |
| `MIGRATION_DATABASE_URL` | Neon **direct** URL |
| `SAFQA_ENV` | `production` |
| `SAFQA_MIGRATE_ON_BUILD` | `true` (migrations run automatically, lock-protected, on each deploy) |
| `SESSION_SECRET` | from step 2 |
| `N8N_WEBHOOK_SECRET` | from step 2 |
| `SAFQA_SETUP_TOKEN` | from step 2 |
| `SAFQA_PUBLIC_URL` | `https://<your-project>.vercel.app` (fill in after the first deploy, then redeploy) |

4. Click **Deploy**. The build runs the migrations first and fails safely if the database isn't reachable.

*Render alternative:* New → Web Service → this repo. Build command: `npm ci && npm run vercel-build`. Start command: `npm start`. Same environment variables.

## Step 4 — Create the owner account (no terminal needed)
Open `https://<your-domain>/login`. While no user exists you are sent to **/setup**. Enter the `SAFQA_SETUP_TOKEN`, your name, email and a password of at least 12 characters. The page **closes permanently** once the owner exists. After that, remove `SAFQA_SETUP_TOKEN` from the environment.

Then, in **الإعدادات ← رأس المال**, record the capital you actually have (for example 5,000 EGP).

## Step 5 — Verify the deployment
From your computer, with the same env values in `.env`:
```bash
npm ci
npm run preflight                       # config + DB + migrations + owner: PASS/WARN/FAIL
BASE_URL=https://<your-domain> N8N_WEBHOOK_SECRET=… npm run security:check
```
To run the full product walkthrough (`npm run test:e2e`), use a **separate demo deployment/database** with `SAFQA_ENV=demo`. The script refuses to run against production.

## Step 6 — n8n Cloud
```bash
SAFQA_PUBLIC_URL=https://<your-domain> npm run n8n:build
```
Then import `n8n/workflows/*.json` following [docs/N8N_SETUP.md](docs/N8N_SETUP.md). Credentials needed: **SAFQA API** (Header Auth, `Authorization: Bearer <N8N_WEBHOOK_SECRET>`), **SAFQA Inbound Webhook** (Header Auth, your own secret) and **SAFQA Telegram Bot**. Activate workflows only after the dashboard works.

## Step 7 — Telegram
See [docs/TELEGRAM_SETUP.md](docs/TELEGRAM_SETUP.md).

## Rollback
- **App:** in Vercel → Deployments, choose a previous deployment and **Promote to Production**.
- **Database:** migrations only add things (no destructive changes). Restore from a Neon branch or backup if needed.
