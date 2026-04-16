/**
 * Dashboard page — shows system status and quick actions.
 */

export const dynamic = "force-dynamic";

async function getStatus() {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/status`, { cache: "no-store" });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default async function DashboardPage() {
  const status = await getStatus();

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold mb-6">System Dashboard</h1>

      {!status ? (
        <div className="rounded-lg border p-6 text-center text-muted-foreground">
          <p>Datenbank nicht verbunden. Richte <code>DATABASE_URL</code> ein und führe <code>npx prisma db push</code> aus.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatusCard title="Subreddits" value={status.subreddits?.active ?? 0} subtitle={`${status.subreddits?.total ?? 0} gesamt`} />
          <StatusCard title="Posts" value={status.posts?.total ?? 0} subtitle={`${status.posts?.processed ?? 0} verarbeitet`} />
          <StatusCard title="Scored" value={status.posts?.scored ?? 0} subtitle="Warten auf Verarbeitung" />
          <StatusCard title="Letzte Ingestion" value={status.lastIngestion ? new Date(status.lastIngestion).toLocaleString("de-DE") : "Noch nie"} />
        </div>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-semibold mb-4">Cron-Endpunkte</h2>
        <div className="rounded-lg border divide-y font-mono text-sm">
          <EndpointRow method="GET" path="/api/cron/discover" description="Neue Subreddits entdecken" />
          <EndpointRow method="GET" path="/api/cron/ingest" description="Posts von Reddit holen" />
          <EndpointRow method="GET" path="/api/cron/process" description="Posts klassifizieren & Content generieren" />
          <EndpointRow method="GET" path="/api/trends" description="Trending Posts abrufen" />
          <EndpointRow method="GET" path="/api/status" description="System-Status" />
        </div>
      </section>
    </main>
  );
}

function StatusCard({ title, value, subtitle }: { title: string; value: string | number; subtitle?: string }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
      {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
    </div>
  );
}

function EndpointRow({ method, path, description }: { method: string; path: string; description: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">{method}</span>
      <code className="flex-1">{path}</code>
      <span className="text-muted-foreground text-xs">{description}</span>
    </div>
  );
}

