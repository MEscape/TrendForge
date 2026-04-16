import { InferenceClient } from "@huggingface/inference";
import { getCached, setCache } from "@/features/shared/cache";

// ─── Client ──────────────────────────────────────────────────────────────────

let _client: InferenceClient | null = null;

function getClient(): InferenceClient {
  if (!_client) {
    const token = process.env.HF_ACCESS_TOKEN;
    if (!token) throw new Error("HF_ACCESS_TOKEN env var is required");
    _client = new InferenceClient(token);
  }
  return _client;
}

// ─── Zero-shot classification ────────────────────────────────────────────────

export interface ZeroShotResult {
  label: string;
  score: number;
}

export async function classifyZeroShot(
  text: string,
  candidateLabels: string[]
): Promise<ZeroShotResult[]> {
  const cacheKey = `zs:${text.slice(0, 80)}`;
  const cached = getCached<ZeroShotResult[]>(cacheKey);
  if (cached) return cached;

  const client = getClient();
  const result = await client.zeroShotClassification({
    model: "facebook/bart-large-mnli",
    inputs: text,
    parameters: { candidate_labels: candidateLabels },
  });

  const item = (Array.isArray(result) ? result[0] : result) as unknown as {
    labels: string[];
    scores: number[];
  };

  const mapped: ZeroShotResult[] = item.labels.map((label: string, i: number) => ({
    label,
    score: item.scores[i],
  }));

  setCache(cacheKey, mapped);
  return mapped;
}

// ─── Emotion analysis ────────────────────────────────────────────────────────

export interface EmotionResult {
  label: string;
  score: number;
}

export async function analyzeEmotion(text: string): Promise<EmotionResult[]> {
  const cacheKey = `emo:${text.slice(0, 80)}`;
  const cached = getCached<EmotionResult[]>(cacheKey);
  if (cached) return cached;

  const client = getClient();
  const result = await client.textClassification({
    model: "SamLowe/roberta-base-go_emotions",
    inputs: text.slice(0, 512),
  });

  const mapped: EmotionResult[] = result.map((r) => ({
    label: r.label,
    score: r.score,
  }));

  setCache(cacheKey, mapped);
  return mapped;
}

// ─── Text generation ─────────────────────────────────────────────────────────

export async function generateText(prompt: string): Promise<string> {
  const cacheKey = `gen:${prompt.slice(0, 100)}`;
  const cached = getCached<string>(cacheKey);
  if (cached) return cached;

  const client = getClient();
  const result = await client.chatCompletion({
    model: "mistralai/Mixtral-8x7B-Instruct-v0.1",
    messages: [
      {
        role: "system",
        content:
          "Du bist ein erfahrener Social-Media-Stratege und Content-Creator, spezialisiert auf TikTok Fitness/Lifestyle Content. Du antwortest IMMER auf Deutsch. Du gibst IMMER valides JSON zurück, ohne Markdown-Codeblöcke.",
      },
      { role: "user", content: prompt },
    ],
    max_tokens: 1500,
    temperature: 0.7,
  });

  const text = result.choices?.[0]?.message?.content ?? "";
  setCache(cacheKey, text);
  return text;
}

