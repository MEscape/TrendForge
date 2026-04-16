/** Topic labels for zero-shot classification */
export const TOPIC_LABELS = [
  "gym anxiety and intimidation",
  "motivation and discipline struggles",
  "beginner mistakes and learning",
  "ego lifting and injuries",
  "diet nutrition and meal planning",
  "body image and self perception",
  "social pressure and gym etiquette",
  "training plateau and stagnation",
  "consistency and building habits",
  "recovery sleep and overtraining",
  "strength gains and personal records",
  "cardio and endurance training",
  "gym culture and community",
  "weight loss and fat loss journey",
  "muscle building and hypertrophy",
  "mental health and fitness mindset",
  "supplement and product discussion",
  "home workout and minimal equipment",
  "flexibility mobility and stretching",
  "running and outdoor fitness",
] as const;

export type TopicLabel = (typeof TOPIC_LABELS)[number];

export type EffortLevel = "Low" | "Medium" | "High";

export interface ContentIdea {
  titel: string;
  beschreibung: string;
  hooks: string[];
  talkingHeadScript: string;
  realtakeTake: string;
  tiktokIdeas: string[];
  cta: string;
}

export interface ViralityScore {
  total: number;
  engagement: number;
  emotionalTrigger: number;
  simplicity: number;
}

