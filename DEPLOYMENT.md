# TrendForge — Deployment Guide

## Lokale Entwicklung (Docker + Prisma)

### 1. PostgreSQL starten

```bash
docker compose up -d
```

`.env` lokal:
```env
DATABASE_URL="postgresql://trendforge:trendforge@localhost:5432/trendforge?schema=public"
CRON_SECRET="dein-sicheres-geheimnis"
HF_ACCESS_TOKEN="hf_..."
NEXT_PUBLIC_BASE_URL="http://localhost:3000"
```

> **Prisma 7 Hinweis:** Die `DATABASE_URL` wird per `prisma.config.ts` übergeben — nicht per `datasource url` im Schema.

### 2. Prisma-Config für lokale DB

`prisma.config.ts` ist bereits mit `dotenv/config` konfiguriert. Die URL aus `.env` wird automatisch geladen.

### 3. Schema deployen

```bash
npx prisma db push
# oder für Migration:
npx prisma migrate dev --name init
```

### 4. Prisma Client generieren

```bash
npx prisma generate
```

### 5. Dev-Server starten

```bash
npm run dev
```

---

## Vercel-Deployment mit Prisma

### Datenbank: Neon (empfohlen — kostenlos, serverless)

1. Account auf [neon.tech](https://neon.tech) erstellen
2. Neues Projekt erstellen → Connection String kopieren (Format: `postgresql://...`)

Alternativ: **Supabase** → Settings → Database → Connection String (Transaction Pooler für Serverless!)

---

### Schritt-für-Schritt Deployment

#### 1. Vercel-Projekt erstellen

```bash
npm i -g vercel
vercel
```

Oder direkt im [Vercel Dashboard](https://vercel.com) → "Add New Project" → GitHub-Repo verbinden.

#### 2. Environment Variables in Vercel setzen

Im Vercel Dashboard → Projekt → **Settings → Environment Variables**:

| Variable | Wert | Umgebungen |
|---|---|---|
| `DATABASE_URL` | `postgresql://user:pass@host/db?sslmode=require` | Production, Preview |
| `CRON_SECRET` | zufälliger String (min. 32 Zeichen) | Production, Preview |
| `HF_ACCESS_TOKEN` | `hf_...` von huggingface.co | Production, Preview |
| `NEXT_PUBLIC_BASE_URL` | `https://deine-domain.vercel.app` | Production |

> ⚠️ **Wichtig für Neon/Supabase:** Connection String muss `?sslmode=require` oder `?pgbouncer=true&connection_limit=1` enthalten für Serverless-Kompatibilität.

#### 3. Prisma in Vercel Build konfigurieren

`package.json` — Build-Script anpassen:

```json
{
  "scripts": {
    "build": "prisma generate && next build"
  }
}
```

> `prisma generate` muss **vor** `next build` laufen damit der Prisma Client im Build enthalten ist.

#### 4. Deployen

```bash
vercel --prod
```

---

### Vercel Cron Jobs (via `vercel.json`)

Die `vercel.json` ist bereits konfiguriert:

```json
{
  "crons": [
    { "path": "/api/cron/discover", "schedule": "0 */12 * * *" },
    { "path": "/api/cron/ingest",   "schedule": "*/15 * * * *" },
    { "path": "/api/cron/process",  "schedule": "*/30 * * * *" }
  ]
}
```

> **Vercel Free Plan Einschränkung:** Cron Jobs sind auf dem Free Plan auf **1 Cron pro Deployment** und **täglich** begrenzt. Auf dem **Hobby Plan ($0)** sind Crons alle 60 Minuten möglich. Für häufigere Ausführung (alle 15 Min) wird der **Pro Plan** benötigt — oder ein **externer Ping-Service**.

#### Externer Cron-Ersatz (kostenlos, Free Plan kompatibel)

**Option A — cron-job.org (empfohlen):**
1. [cron-job.org](https://cron-job.org) → Account erstellen
2. Drei Cron Jobs anlegen:
   - URL: `https://deine-domain.vercel.app/api/cron/discover` — alle 12h
   - URL: `https://deine-domain.vercel.app/api/cron/ingest` — alle 15 Min
   - URL: `https://deine-domain.vercel.app/api/cron/process` — alle 30 Min
3. Header hinzufügen: `Authorization: Bearer <CRON_SECRET>`

**Option B — UptimeRobot:**
- Monitor-Typ: HTTP(S), Intervall: 5 Min (Minimum)
- URL: `https://deine-domain.vercel.app/api/cron/ingest`
- Custom Header: `Authorization: Bearer <CRON_SECRET>`

---

### Cron-Endpunkte manuell testen

```bash
# Lokal
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/discover
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/ingest
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/process

# Produktion
curl -H "Authorization: Bearer $CRON_SECRET" https://deine-domain.vercel.app/api/cron/discover
```

---

### Prisma Migrations in CI/CD

Für Production-Migrations empfiehlt sich ein separater Schritt:

```bash
# Einmalig / bei Schemaänderungen:
npx prisma migrate deploy
```

In Vercel kannst du dies als Post-Build-Command in den Vercel Settings eintragen oder via GitHub Actions:

```yaml
# .github/workflows/migrate.yml
name: Prisma Migrate
on:
  push:
    branches: [main]
    paths: ["prisma/schema.prisma"]
jobs:
  migrate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npx prisma migrate deploy
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

---

### Troubleshooting

**Prisma Client nicht gefunden im Build:**
→ Sicherstellen dass `prisma generate` im Build-Script vor `next build` steht.

**Connection Timeout auf Vercel:**
→ Neon/Supabase Pooler-URL verwenden (`?pgbouncer=true&connection_limit=1`) oder Prisma Accelerate.

**429 von Reddit:**
→ Cron-Intervall erhöhen; der Token-Bucket Rate Limiter drosselt automatisch, aber bei zu häufigen Aufrufen hilft nur weniger Frequenz.

**`CRON_SECRET` nicht gesetzt:**
→ Im Dev-Modus wird der Cron-Endpunkt ohne Secret zugelassen; in Production schlägt er fehl. Immer setzen!

