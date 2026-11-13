import "server-only";
import { z } from "zod";

/**
 * All server configuration lives in environment variables (set them in
 * Railway's "Variables" tab, or in `.env.local` for local development).
 * (Auth settings are read in lib/auth.ts, which must stay importable from
 * proxy.ts and therefore avoids the "server-only" marker.)
 * Each group is validated lazily so a missing Azure key, say, produces a
 * clear error on the voice routes instead of crashing the whole app.
 */

const nonEmpty = z.string().trim().min(1);
/** Optional variable with a default; an empty string counts as unset. */
const withDefault = (value: string) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), nonEmpty.default(value));

const claudeSchema = z.object({
  ANTHROPIC_API_KEY: nonEmpty,
  TUTOR_MODEL: withDefault("claude-opus-5-5"),
  // Effort trades depth of reasoning for speed. "low" keeps spoken replies
  // snappy; raise it if you want more thorough explanations.
  TUTOR_EFFORT: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.enum(["low", "medium", "high", "xhigh", "max"]).default("low"),
  ),
});

const speechSchema = z.object({
  AZURE_SPEECH_KEY: nonEmpty,
  AZURE_SPEECH_REGION: nonEmpty.transform((s) => s.toLowerCase()),
  TTS_VOICE_EN: withDefault("en-US-AvaMultilingualNeural"),
  TTS_VOICE_ZH: withDefault("zh-CN-XiaoxiaoNeural"),
  // Empty = Azure's multilingual model, which handles English and Mandarin
  // in the same recording. Set e.g. "en-US,zh-CN" to use language ID instead.
  STT_LOCALES: z
    .string()
    .default("")
    .transform((s) =>
      s
        .split(",")
        .map((l) => l.trim())
        .filter(Boolean),
    ),
});

const dbSchema = z
  .object({
    SUPABASE_URL: z.url(),
    SUPABASE_SECRET_KEY: z.string().optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  })
  .transform((v, ctx) => {
    const key = v.SUPABASE_SECRET_KEY?.trim() || v.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!key) {
      ctx.addIssue({
        code: "custom",
        message: "Set SUPABASE_SECRET_KEY (or the legacy SUPABASE_SERVICE_ROLE_KEY)",
      });
      return z.NEVER;
    }
    return { SUPABASE_URL: v.SUPABASE_URL, SUPABASE_KEY: key };
  });

export class ConfigError extends Error {
  constructor(group: string, issues: z.core.$ZodIssue[]) {
    const detail = issues.map((i) => `${i.path.join(".") || "env"}: ${i.message}`).join("; ");
    super(`Missing or invalid ${group} configuration — ${detail}`);
    this.name = "ConfigError";
  }
}

function loader<S extends z.ZodType>(group: string, schema: S): () => z.output<S> {
  let cached: z.output<S> | undefined;
  return () => {
    if (cached !== undefined) return cached;
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) throw new ConfigError(group, parsed.error.issues);
    cached = parsed.data;
    return cached;
  };
}

export const claudeEnv = loader("Claude", claudeSchema);
export const speechEnv = loader("Azure Speech", speechSchema);
export const dbEnv = loader("Supabase", dbSchema);
