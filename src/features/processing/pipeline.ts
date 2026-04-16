/**
 * Processing Pipeline
 *
 * Second-stage pipeline that reads SCORED posts from DB,
 * classifies them with HF, generates content ideas, and
 * stores results back in DB.
 *
 * Fully decoupled from ingestion — reads only from DB.
 */

import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { batchProcess } from "@/features/shared/cache";
import { classifyZeroShot, analyzeEmotion, generateText } from "./hf-client";
import { TOPIC_LABELS, type ContentIdea, type ViralityScore, type EffortLevel } from "./types";

const PROCESS_BATCH_SIZE = 10; // Posts per cron invocation

export interface ProcessingResult {
  postsProcessed: number;
  contentGenerated: number;
  duration: number;
}

// ─── Emotions that signal high virality ─────────────────────────────────────

const VIRAL_EMOTIONS = new Set([
  "anger", "surprise", "fear", "sadness", "disgust",
  "annoyance", "disappointment", "excitement", "curiosity",
  "confusion", "embarrassment", "nervousness",
]);

// ─── Classification ──────────────────────────────────────────────────────────

async function classifyPost(post: { id: string; title: string; selftext: string }) {
  const text = `${post.title}${post.selftext ? ". " + post.selftext.slice(0, 200) : ""}`;

  const [classification, emotions] = await Promise.all([
    classifyZeroShot(text, [...TOPIC_LABELS]),
    analyzeEmotion(text),
  ]);

  const best = classification[0] ?? { label: "gym culture and community", score: 0.3 };

  return {
    topicLabel: best.label,
    confidence: best.score,
    emotions: emotions.slice(0, 5),
  };
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

function computeViralityScore(
  trendScore: number,
  emotions: Array<{ label: string; score: number }>,
  confidence: number
): ViralityScore {
  const rawEngagement = trendScore;
  const engagement = Math.min(100, Math.round((rawEngagement / (rawEngagement + 50)) * 100));

  const viralEmotionScore = emotions
    .filter((e) => VIRAL_EMOTIONS.has(e.label))
    .reduce((sum, e) => sum + e.score, 0);
  const emotionalTrigger = Math.min(100, Math.round(viralEmotionScore * 100));

  const simplicity = Math.min(100, Math.round(confidence * 100));

  const total = Math.round(engagement * 0.45 + emotionalTrigger * 0.35 + simplicity * 0.2);

  return {
    total: Math.max(1, Math.min(100, total)),
    engagement,
    emotionalTrigger,
    simplicity,
  };
}

function getEffort(emotions: Array<{ label: string; score: number }>): EffortLevel {
  const hasStrongEmotion = emotions.some(
    (e) => VIRAL_EMOTIONS.has(e.label) && e.score > 0.3
  );
  return hasStrongEmotion ? "Low" : "Medium";
}

// ─── Content Generation ──────────────────────────────────────────────────────

async function generateContentForPost(
  post: { title: string; selftext: string; subredditName: string; upvotes: number; comments: number },
  topicLabel: string,
  emotions: Array<{ label: string; score: number }>
): Promise<ContentIdea> {
  const emotionStr = emotions.slice(0, 3).map((e) => e.label).join(", ");

  const prompt = `Analysiere diesen aktuellen Reddit-Trend und erstelle TikTok Content-Ideen auf DEUTSCH.

## Trend-Thema
"${topicLabel}"
Subreddit: r/${post.subredditName}
Emotionen: ${emotionStr || "neutral"}

## Reddit-Post
"${post.title}" (↑${post.upvotes} 💬${post.comments})
${post.selftext.slice(0, 200)}

## Aufgabe
Erstelle ein JSON-Objekt mit GENAU diesen Feldern (alle auf Deutsch):
{
  "titel": "Kurzer, knackiger Titel (max 8 Wörter)",
  "beschreibung": "1-2 Sätze warum dieser Trend viral geht",
  "hooks": ["Hook 1", "Hook 2", "Hook 3"],
  "talkingHeadScript": "15-20 Sekunden Script",
  "realtakeTake": "Kontroverse Meinung",
  "tiktokIdeas": ["Idee 1", "Idee 2", "Idee 3"],
  "cta": "Call-to-Action"
}

Gib NUR das JSON zurück.`;

  try {
    const raw = await generateText(prompt);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      titel: parsed.titel || topicLabel,
      beschreibung: parsed.beschreibung || "",
      hooks: Array.isArray(parsed.hooks) ? parsed.hooks.slice(0, 3) : [],
      talkingHeadScript: parsed.talkingHeadScript || "",
      realtakeTake: parsed.realtakeTake || "",
      tiktokIdeas: Array.isArray(parsed.tiktokIdeas) ? parsed.tiktokIdeas.slice(0, 3) : [],
      cta: parsed.cta || "",
    };
  } catch {
    return {
      titel: topicLabel,
      beschreibung: `Trending Thema in r/${post.subredditName}`,
      hooks: [`Das muss mal gesagt werden: ${post.title}`],
      talkingHeadScript: `Ich muss mal was loswerden zum Thema ${topicLabel}.`,
      realtakeTake: "Die meisten Leute haben die komplett falsche Einstellung.",
      tiktokIdeas: [`Talking Head: Ehrliche Meinung zu ${topicLabel}`],
      cta: "Was ist deine Meinung? Kommentier ehrlich 👇",
    };
  }
}

// ─── Main Pipeline ───────────────────────────────────────────────────────────

export async function runProcessing(): Promise<ProcessingResult> {
  const start = Date.now();

  // Get unprocessed posts (SCORED but not yet CLASSIFIED or PROCESSED)
  const posts = await prisma.redditPost.findMany({
    where: { status: "SCORED" },
    orderBy: { trendScore: "desc" },
    take: PROCESS_BATCH_SIZE,
  });

  if (posts.length === 0) {
    return { postsProcessed: 0, contentGenerated: 0, duration: Date.now() - start };
  }

  let contentGenerated = 0;

  // Classify posts in batches
  type ClassifiedItem = {
    post: typeof posts[number];
    topicLabel: string;
    confidence: number;
    emotions: Array<{ label: string; score: number }>;
  };
  const classified = await batchProcess<typeof posts[number], ClassifiedItem>(
    posts,
    async (post) => {
      const result = await classifyPost(post);
      return { post, ...result };
    },
    3,
    500
  );

  // Process each classified post
  for (const item of classified) {
    try {
      const viralityScore = computeViralityScore(
        item.post.trendScore ?? 0,
        item.emotions,
        item.confidence
      );

      const effort = getEffort(item.emotions);

      // Generate content only for high-scoring posts
      let contentIdea: ContentIdea | null = null;
      if (viralityScore.total >= 30) {
        contentIdea = await generateContentForPost(
          item.post,
          item.topicLabel,
          item.emotions
        );
        contentGenerated++;
      }

      // Save processed data
      await prisma.processedPost.upsert({
        where: { postId: item.post.id },
        create: {
          postId: item.post.id,
          topicLabel: item.topicLabel,
          confidence: item.confidence,
          emotions: item.emotions as Prisma.InputJsonValue,
          contentIdea: (contentIdea ?? undefined) as Prisma.InputJsonValue | undefined,
          viralityScore: viralityScore.total,
          viralityBreakdown: {
            ...viralityScore,
            effort,
          },
        },
        update: {
          topicLabel: item.topicLabel,
          confidence: item.confidence,
          emotions: item.emotions as Prisma.InputJsonValue,
          contentIdea: (contentIdea ?? undefined) as Prisma.InputJsonValue | undefined,
          viralityScore: viralityScore.total,
          viralityBreakdown: {
            ...viralityScore,
            effort,
          },
        },
      });

      // Update post status
      await prisma.redditPost.update({
        where: { id: item.post.id },
        data: { status: contentIdea ? "PROCESSED" : "CLASSIFIED" },
      });
    } catch (error) {
      console.error(`Failed to process post ${item.post.id}:`, error);
    }
  }

  return {
    postsProcessed: classified.length,
    contentGenerated,
    duration: Date.now() - start,
  };
}





