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

const unsetIfBlank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const azureSchema = z.object({
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

const elevenLabsSchema = z
  .object({
    ELEVENLABS_API_KEY: nonEmpty,
    // "George", the voice used in ElevenLabs' own examples, so it exists on
    // every account. Pick any voice from your ElevenLabs voice library.
    ELEVENLABS_VOICE_ID: withDefault("JBFqnCBsd6RMkjVDRZzb"),
    // Optional separate voice for Chinese (e.g. a native Mandarin speaker).
    ELEVENLABS_VOICE_ID_ZH: z.preprocess(unsetIfBlank, nonEmpty.optional()),
    ELEVENLABS_TTS_MODEL: withDefault("eleven_v4"),
    ELEVENLABS_STT_MODEL: withDefault("scribe_v3"),
  })
  .transform((v) => ({ ...v, ELEVENLABS_VOICE_ID_ZH: v.ELEVENLABS_VOICE_ID_ZH ?? v.ELEVENLABS_VOICE_ID }));

const providerSchema = z.object({
  STT_PROVIDER: z.preprocess(unsetIfBlank, z.enum(["elevenlabs", "azure"]).optional()),
  TTS_PROVIDER: z.preprocess(unsetIfBlank, z.enum(["elevenlabs", "azure"]).optional()),
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
  constructor(group: string, issues: z.core.$ZodIssue[] | string) {
    const detail =
      typeof issues === "string" ? issues : issues.map((i) => `${i.path.join(".") || "env"}: ${i.message}`).join("; ");
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
export const azureEnv = loader("Azure Speech", azureSchema);
export const elevenLabsEnv = loader("ElevenLabs", elevenLabsSchema);
export const dbEnv = loader("Supabase", dbSchema);
const providerEnv = loader("speech provider", providerSchema);

const isSet = (name: string) => Boolean(process.env[name]?.trim());

export type SpeechProvider = "elevenlabs" | "azure";

export interface SpeechSetup {
  /** Transcribes what you say in conversation. */
  stt: SpeechProvider;
  /** Reads the tutor's replies aloud. */
  tts: SpeechProvider;
  /** Scores practice attempts: Azure's assessment if available, else an ElevenLabs clarity check. */
  pronunciation: SpeechProvider;
}

/**
 * Which service does what. With only ElevenLabs configured it does
 * everything; adding Azure keys upgrades pronunciation scoring to Azure's
 * phoneme-level assessment. STT_PROVIDER / TTS_PROVIDER override the defaults.
 */
export function speechSetup(): SpeechSetup {
  const has = {
    elevenlabs: isSet("ELEVENLABS_API_KEY"),
    azure: isSet("AZURE_SPEECH_KEY") && isSet("AZURE_SPEECH_REGION"),
  };
  if (!has.elevenlabs && !has.azure) {
    throw new ConfigError("speech", "set ELEVENLABS_API_KEY, or AZURE_SPEECH_KEY and AZURE_SPEECH_REGION");
  }
  const preferred: SpeechProvider = has.elevenlabs ? "elevenlabs" : "azure";
  const { STT_PROVIDER, TTS_PROVIDER } = providerEnv();
  const setup: SpeechSetup = {
    stt: STT_PROVIDER ?? preferred,
    tts: TTS_PROVIDER ?? preferred,
    pronunciation: has.azure ? "azure" : "elevenlabs",
  };
  for (const [role, provider] of Object.entries(setup) as Array<[string, SpeechProvider]>) {
    if (!has[provider]) {
      throw new ConfigError("speech", `${role} is set to use ${provider}, but its keys aren't configured`);
    }
  }
  return setup;
}
