# TrendForge — Deployment Guide

## Lokale Entwicklung (Docker + Prisma)

### 1. PostgreSQL starten

```bash
docker compose up -d
```

`.env` lokal:
```env
DATABASE_URL="postgresql://trendforge:trendforge@localhost:5432/trendforge?schema=public"
CRON_SECRET="dein-sicheres-geheimnis-min32zeichen"
HF_ACCESS_TOKEN="hf_..."
NEXT_PUBLIC_BASE_URL="http://localhost:3000"
```

### 2. Schema deployen

```bash
# Schema direkt pushen (kein Migration-History, ideal für Entwicklung)
npx prisma db push

# Oder mit Migration-History (empfohlen für Production):
npx prisma migrate dev --name init
```

> **Prisma 7 Architektur:** Die `DATABASE_URL` im Schema ist entfernt.  
> Für die CLI (`prisma migrate`, `db push`) → `prisma.config.ts`  
> Für den Runtime-Client → `@prisma/adapter-pg` mit `DATABASE_URL` aus `.env`

### 3. Dev-Server starten

```bash
npm run dev
```

---

## Vercel-Deployment

### Voraussetzung: PostgreSQL-Datenbank

**Neon (empfohlen — kostenlos, serverless):**
1. Account auf [neon.tech](https://neon.tech) erstellen
2. Neues Projekt → **Connection String** kopieren → "Pooled connection" aktivieren

Connection String Format:
```
postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require
```

**Supabase (Alternative):**  
Settings → Database → Connection String → **Transaction Pooler** (für Serverless zwingend)

---

### Schritt-für-Schritt

#### 1. Repo auf GitHub pushen

```bash
git add .
git commit -m "feat: initial trendforge architecture"
git push
```

#### 2. Vercel-Projekt anlegen

Im [Vercel Dashboard](https://vercel.com):
- "Add New Project" → GitHub-Repo auswählen → Import

#### 3. Environment Variables in Vercel setzen

Vercel Dashboard → Projekt → **Settings → Environment Variables**:

| Variable | Beispielwert | Wo |
|---|---|---|
| `DATABASE_URL` | `postgresql://user:pass@host/db?sslmode=require` | Production + Preview |
| `CRON_SECRET` | `openssl rand -hex 32` Ausgabe | Production + Preview |
| `HF_ACCESS_TOKEN` | `hf_...` von [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens) | Production + Preview |
| `NEXT_PUBLIC_BASE_URL` | `https://deine-domain.vercel.app` | Production |

> ⚠️ **Wichtig:** `DATABASE_URL` muss **auch im Build-Environment** gesetzt sein (Vercel setzt alle Env Vars standardmäßig für Build + Runtime).

#### 4. Build Command

`vercel.json` enthält bereits:
```json
{ "buildCommand": "prisma generate && next build" }
```

`prisma generate` erzeugt den Prisma Client mit dem `@prisma/adapter-pg` — muss **vor** `next build` laufen.

#### 5. Schema auf Production-DB deployen

Einmalig nach dem ersten Deployment oder bei Schemaänderungen:

```bash
# Lokal gegen Production-DB (DATABASE_URL auf Neon-URL setzen):
DATABASE_URL="postgresql://..." npx prisma migrate deploy
```

Oder automatisiert via GitHub Actions (siehe unten).

#### 6. Deployen

```bash
vercel --prod
# oder: Git-Push auf main triggert Auto-Deploy
```

---

## Cron-Jobs mit cron-job.org

Da Vercel Free Plan keine häufigen Crons unterstützt, nutzen wir **cron-job.org** (kostenlos, unbegrenzt).

### Setup

1. Account auf [cron-job.org](https://cron-job.org) erstellen
2. Dashboard → **"Create cronjob"**
3. Drei Jobs anlegen:

---

**Job 1 — Subreddit Discovery** (alle 12 Stunden reicht)

| Feld | Wert |
|---|---|
| URL | `https://DEINE-DOMAIN.vercel.app/api/cron/discover` |
| Schedule | `0 */12 * * *` (alle 12h) |
| Request Method | `GET` |
| Headers | `Authorization: Bearer DEIN_CRON_SECRET` |

---

**Job 2 — Reddit Ingestion** (alle 15 Minuten)

| Feld | Wert |
|---|---|
| URL | `https://DEINE-DOMAIN.vercel.app/api/cron/ingest` |
| Schedule | `*/15 * * * *` |
| Request Method | `GET` |
| Headers | `Authorization: Bearer DEIN_CRON_SECRET` |

---

**Job 3 — Content Processing** (alle 30 Minuten)

| Feld | Wert |
|---|---|
| URL | `https://DEINE-DOMAIN.vercel.app/api/cron/process` |
| Schedule | `*/30 * * * *` |
| Request Method | `GET` |
| Headers | `Authorization: Bearer DEIN_CRON_SECRET` |

---

### Custom Header in cron-job.org eintragen

Im Job-Editor: **"Advanced"** → **"Custom request headers"**:
```
Authorization: Bearer dein-cron-secret-hier
```

### Manuell testen (lokal)

```bash
# .env Werte laden und testen:
curl -H "Authorization: Bearer $(grep CRON_SECRET .env | cut -d= -f2 | tr -d '\"')" \
  http://localhost:3000/api/cron/discover

curl -H "Authorization: Bearer $(grep CRON_SECRET .env | cut -d= -f2 | tr -d '\"')" \
  http://localhost:3000/api/cron/ingest
```

### Manuell testen (Produktion)

```bash
CRON_SECRET="dein-secret"
BASE="https://deine-domain.vercel.app"

curl -H "Authorization: Bearer $CRON_SECRET" $BASE/api/cron/discover
curl -H "Authorization: Bearer $CRON_SECRET" $BASE/api/cron/ingest
curl -H "Authorization: Bearer $CRON_SECRET" $BASE/api/cron/process
curl $BASE/api/status
```

---

## Prisma Migrations in CI/CD (optional)

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

## Troubleshooting

**Build schlägt fehl: "DATABASE_URL is not set"**  
→ In Vercel: Settings → Environment Variables → sicherstellen dass `DATABASE_URL` für **alle** Environments gesetzt ist (Production + Preview + Development).

**Build schlägt fehl: Prisma Client error**  
→ `vercel.json` `buildCommand` enthält `prisma generate && next build`? Nach Schemaänderungen immer neu generieren.

**Prisma 7: `adapter` Pflicht**  
→ `new PrismaClient()` ohne `adapter` wirft in Prisma 7 wenn kein `url` im Schema. Das Projekt nutzt `@prisma/adapter-pg` — bereits konfiguriert in `src/lib/db.ts`.

**Connection Timeout auf Vercel**  
→ Neon Pooled Connection URL verwenden (nicht Direct Connection). Supabase: Transaction Pooler Port 6543.

**cron-job.org 401 Unauthorized**  
→ Header exakt prüfen: `Authorization: Bearer <secret>` — kein Leerzeichen, kein Zeilenumbruch im Secret.

**429 von Reddit**  
→ Cron-Intervall für `/api/cron/ingest` erhöhen (z.B. alle 30 Min statt 15). Der Token-Bucket Rate Limiter drosselt automatisch, aber serverseitige Reddit-Limits gelten trotzdem.
