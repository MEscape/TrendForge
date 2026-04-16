/**
 * Dashboard page — shows system status and quick actions.
 */

import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import type { ContentIdea } from "@/features/processing/types";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const dynamic = "force-dynamic";

// ─── Data fetching ────────────────────────────────────────────────────────────

async function getDashboardData() {
  try {
    const [stats, trendingPosts, contentOpportunities] = await Promise.all([
      // System stats
      Promise.all([
        prisma.subreddit.count({ where: { isActive: true } }),
        prisma.redditPost.count(),
        prisma.redditPost.count({ where: { status: "SCORED" } }),
        prisma.redditPost.count({ where: { status: { in: ["CLASSIFIED", "PROCESSED"] } } }),
        prisma.ingestionCursor.findUnique({ where: { id: "singleton" } }),
      ]).then(([activeSubs, totalPosts, pendingPosts, processedPosts, cursor]) => ({
        activeSubs,
        totalPosts,
        pendingPosts,
        processedPosts,
        lastIngestion: cursor?.lastRunAt ?? null,
      })),

      // Top trending posts (scored or above)
      prisma.redditPost.findMany({
        where: { trendScore: { not: null } },
        orderBy: { trendScore: "desc" },
        take: 20,
        select: {
          id: true,
          title: true,
          subredditName: true,
          upvotes: true,
          comments: true,
          trendScore: true,
          engagementRate: true,
          ageHours: true,
          permalink: true,
          flair: true,
          status: true,
        },
      }),

      // Processed posts with content ideas
      prisma.processedPost.findMany({
        where: {
          contentIdea: { not: Prisma.JsonNull },
          viralityScore: { not: null },
        },
        orderBy: { viralityScore: "desc" },
        take: 10,
        select: {
          id: true,
          topicLabel: true,
          viralityScore: true,
          viralityBreakdown: true,
          contentIdea: true,
          post: {
            select: {
              title: true,
              subredditName: true,
              upvotes: true,
              comments: true,
              permalink: true,
              trendScore: true,
            },
          },
        },
      }),
    ]);

    return { stats, trendingPosts, contentOpportunities };
  } catch {
    return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(hours: number | null): string {
  if (!hours) return "–";
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

function statusColor(status: string) {
  switch (status) {
    case "PROCESSED": return "bg-green-500/15 text-green-700 dark:text-green-400";
    case "CLASSIFIED": return "bg-blue-500/15 text-blue-700 dark:text-blue-400";
    case "SCORED": return "bg-orange-500/15 text-orange-700 dark:text-orange-400";
    default: return "bg-muted text-muted-foreground";
  }
}

function scoreColor(score: number) {
  if (score >= 70) return "text-green-600 dark:text-green-400";
  if (score >= 40) return "text-yellow-600 dark:text-yellow-400";
  return "text-muted-foreground";
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const data = await getDashboardData();

  if (!data) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-8 text-center">
          <p className="font-semibold text-destructive mb-2">Datenbank nicht erreichbar</p>
          <p className="text-sm text-muted-foreground">
            Setze <code className="bg-muted px-1 rounded">DATABASE_URL</code> und führe{" "}
            <code className="bg-muted px-1 rounded">npx prisma db push</code> aus.
          </p>
        </div>
      </main>
    );
  }

  const { stats, trendingPosts, contentOpportunities } = data;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Aktive Subreddits" value={stats.activeSubs} />
        <StatCard label="Posts gesamt" value={stats.totalPosts} />
        <StatCard label="Ausstehend" value={stats.pendingPosts} dim />
        <StatCard
          label="Letzte Ingestion"
          value={stats.lastIngestion
            ? new Date(stats.lastIngestion).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
            : "–"}
          sub={stats.lastIngestion
            ? new Date(stats.lastIngestion).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })
            : "noch nie"}
        />
      </div>

      {/* Main tabs */}
      <Tabs defaultValue="trends">
        <TabsList>
          <TabsTrigger value="trends">
            🔥 Trending Posts
            <span className="ml-2 text-xs bg-muted px-1.5 py-0.5 rounded-full">{trendingPosts.length}</span>
          </TabsTrigger>
          <TabsTrigger value="content">
            ✨ Content Ideas
            <span className="ml-2 text-xs bg-muted px-1.5 py-0.5 rounded-full">{contentOpportunities.length}</span>
          </TabsTrigger>
        </TabsList>

        {/* ── Trending Posts ── */}
        <TabsContent value="trends" className="mt-4 space-y-2">
          {trendingPosts.length === 0 ? (
            <EmptyState message="Noch keine Posts — starte /api/cron/ingest um Daten zu laden." />
          ) : (
            trendingPosts.map((post) => (
              <a
                key={post.id}
                href={`https://reddit.com${post.permalink}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-lg border bg-card hover:bg-accent/40 transition-colors p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm leading-snug line-clamp-2">{post.title}</p>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <span className="text-xs text-muted-foreground">r/{post.subredditName}</span>
                      {post.flair && (
                        <span className="text-xs bg-secondary px-1.5 py-0.5 rounded-full">{post.flair}</span>
                      )}
                      <span className="text-xs text-muted-foreground">↑{post.upvotes.toLocaleString()}</span>
                      <span className="text-xs text-muted-foreground">💬{post.comments.toLocaleString()}</span>
                      <span className="text-xs text-muted-foreground">{timeAgo(post.ageHours)}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${statusColor(post.status)}`}>
                        {post.status}
                      </span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-lg font-bold tabular-nums ${scoreColor(post.trendScore ?? 0)}`}>
                      {post.trendScore?.toFixed(1)}
                    </p>
                    <p className="text-xs text-muted-foreground">Score</p>
                  </div>
                </div>
              </a>
            ))
          )}
        </TabsContent>

        {/* ── Content Ideas ── */}
        <TabsContent value="content" className="mt-4 space-y-4">
          {contentOpportunities.length === 0 ? (
            <EmptyState message="Noch keine Content Ideas — starte /api/cron/process um Posts zu verarbeiten." />
          ) : (
            contentOpportunities.map((opp) => {
              const idea = opp.contentIdea as unknown as ContentIdea;
              const breakdown = opp.viralityBreakdown as Record<string, number> | null;
              return (
                <div key={opp.id} className="rounded-lg border bg-card p-5 space-y-4">

                  {/* Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-base leading-tight">{idea.titel}</h3>
                      <p className="text-sm text-muted-foreground mt-1">{idea.beschreibung}</p>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <Badge variant="secondary">r/{opp.post.subredditName}</Badge>
                        {opp.topicLabel && (
                          <Badge variant="outline" className="text-xs">{opp.topicLabel}</Badge>
                        )}
                        <span className="text-xs text-muted-foreground">
                          ↑{opp.post.upvotes.toLocaleString()} · 💬{opp.post.comments.toLocaleString()}
                        </span>
                      </div>
                    </div>
                    <div className="text-center shrink-0">
                      <div className={`text-3xl font-bold tabular-nums ${scoreColor(opp.viralityScore ?? 0)}`}>
                        {opp.viralityScore}
                      </div>
                      <p className="text-xs text-muted-foreground">Virality</p>
                    </div>
                  </div>

                  {/* Virality breakdown */}
                  {breakdown && (
                    <div className="space-y-1.5">
                      <ScoreBar label="Engagement" value={breakdown.engagement ?? 0} />
                      <ScoreBar label="Emotion" value={breakdown.emotionalTrigger ?? 0} />
                      <ScoreBar label="Klarheit" value={breakdown.simplicity ?? 0} />
                    </div>
                  )}

                  {/* Hooks */}
                  {idea.hooks?.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Hooks</p>
                      <div className="space-y-1">
                        {idea.hooks.map((hook, i) => (
                          <p key={i} className="text-sm border-l-2 border-primary pl-3 italic">&#34;{hook}&#34;</p>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Script */}
                  {idea.talkingHeadScript && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">🎥 Talking Head Script</p>
                      <p className="text-sm bg-muted/50 rounded-md p-3">{idea.talkingHeadScript}</p>
                    </div>
                  )}

                  {/* Realtake */}
                  {idea.realtakeTake && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">🔥 Realtake</p>
                      <p className="text-sm text-foreground/90">{idea.realtakeTake}</p>
                    </div>
                  )}

                  {/* TikTok ideas */}
                  {idea.tiktokIdeas?.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">📱 TikTok-Ideen</p>
                      <ul className="space-y-1">
                        {idea.tiktokIdeas.map((tip, i) => (
                          <li key={i} className="text-sm flex gap-2">
                            <span className="text-muted-foreground shrink-0">{i + 1}.</span>
                            <span>{tip}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* CTA */}
                  {idea.cta && (
                    <p className="text-sm font-medium border rounded-md px-3 py-2 bg-primary/5">
                      💬 {idea.cta}
                    </p>
                  )}

                  {/* Source post link */}
                  <a
                    href={`https://reddit.com${opp.post.permalink}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    → Quell-Post: {opp.post.title.slice(0, 80)}{opp.post.title.length > 80 ? "…" : ""}
                  </a>
                </div>
              );
            })
          )}
        </TabsContent>
      </Tabs>
    </main>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ label, value, sub, dim }: { label: string; value: string | number; sub?: string; dim?: boolean }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold mt-0.5 tabular-nums ${dim ? "text-muted-foreground" : ""}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-muted-foreground w-20 shrink-0">{label}</span>
      <Progress value={value} className="h-1.5 flex-1" />
      <span className="text-xs tabular-nums text-muted-foreground w-8 text-right">{value}</span>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

