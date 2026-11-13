import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { claudeEnv } from "@/lib/env";
import { splitSystemPrompt } from "@/lib/tutor/prompt";
import { normalizeReply, TutorReplySchema } from "@/lib/tutor/schema";
import type { TutorReply } from "@/lib/types";

type BetaMessageParam = Anthropic.Beta.BetaMessageParam;
type BetaContentBlock = Anthropic.Beta.BetaContentBlock;
type BetaContentBlockParam = Anthropic.Beta.BetaContentBlockParam;

const BETAS: Anthropic.Beta.AnthropicBeta[] = [
  // If a safety classifier declines a turn (rare for a language tutor, but
  // possible), the API retries it on a fallback model inside the same call.
  "server-side-fallback-2026-07-01",
  // Lets us ask the API to drop, rather than reject, any reasoning block whose
  // conversation prefix no longer matches. Our history is append-only, so
  // this should never trigger; it's a safety net, logged when it does.
  "thinking-binding-controls-2026-08-01",
];

// Strip the client-side parse hook: we parse the JSON ourselves so we can pick
// the right text block when a fallback happened mid-response.
const { type: formatType, schema: replySchema } = betaZodOutputFormat(TutorReplySchema);
// The SDK parks zod's unsupported "$schema" key in the root description;
// it means nothing to the model, so leave it out.
const { description: rootNote, ...schemaBody } = replySchema as { description?: unknown } & Record<string, unknown>;
export const OUTPUT_FORMAT = {
  type: formatType,
  schema: typeof rootNote === "string" && rootNote.startsWith("{$schema") ? schemaBody : replySchema,
};

let client: Anthropic | undefined;
function anthropic(): Anthropic {
  client ??= new Anthropic({ apiKey: claudeEnv().ANTHROPIC_API_KEY, maxRetries: 2 });
  return client;
}

export class TutorError extends Error {
  constructor(
    message: string,
    readonly userMessage: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = "TutorError";
  }
}

export interface TutorTurn {
  reply: TutorReply;
  /** Assistant content to store and replay verbatim on later turns. */
  assistantContent: BetaContentBlockParam[];
  model: string;
}

export async function runTutorTurn(input: {
  systemPrompt: string;
  history: BetaMessageParam[];
  userContent: string;
}): Promise<TutorTurn> {
  const env = claudeEnv();
  const { staticPart, dynamicPart } = splitSystemPrompt(input.systemPrompt);
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    // The static instructions are the same for every session: cache them.
    { type: "text", text: staticPart, cache_control: { type: "ephemeral" } },
  ];
  if (dynamicPart) system.push({ type: "text", text: dynamicPart });

  let message: Anthropic.Beta.BetaMessage;
  try {
    const stream = anthropic().beta.messages.stream({
      model: env.TUTOR_MODEL,
      max_tokens: 16000,
      betas: BETAS,
      fallbacks: "default",
      thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } },
      output_config: { effort: env.TUTOR_EFFORT, format: OUTPUT_FORMAT },
      // Automatic caching of the growing conversation.
      cache_control: { type: "ephemeral" },
      system,
      messages: [...input.history, { role: "user", content: input.userContent }],
    });
    message = await stream.finalMessage();
  } catch (error) {
    throw toTutorError(error);
  }

  logTransformations(message);

  if (message.stop_reason === "refusal") {
    throw new TutorError(
      `Claude declined the turn (category: ${message.stop_details?.category ?? "unknown"})`,
      "The tutor couldn't answer that one. Try rephrasing, or ask about something else.",
    );
  }
  if (message.stop_reason === "max_tokens") {
    throw new TutorError("Reply hit max_tokens", "The tutor's reply was cut off. Please try again.");
  }

  const reply = parseReply(message.content);
  if (!reply) {
    throw new TutorError(
      "Could not parse the tutor's structured reply",
      "The tutor's reply came back garbled. Please try again.",
    );
  }

  return { reply, assistantContent: toReplayContent(message.content), model: message.model };
}

/** The JSON reply is the text after the last fallback boundary, if any. */
export function parseReply(content: BetaContentBlock[]): TutorReply | null {
  const lastFallback = content.findLastIndex((b) => b.type === "fallback");
  const text = content
    .slice(lastFallback + 1)
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  if (!text.trim()) return null;
  try {
    const parsed = TutorReplySchema.safeParse(JSON.parse(text));
    return parsed.success ? normalizeReply(parsed.data) : null;
  } catch {
    return null;
  }
}

/**
 * Convert a response's content into request params for replay, preserving
 * block order (reasoning blocks are bound to their exact position).
 *
 * After a mid-response fallback, the API requires dropping the declining
 * model's thinking/tool blocks that come before the last `fallback` block,
 * while keeping the fallback block itself in place.
 */
export function toReplayContent(content: BetaContentBlock[]): BetaContentBlockParam[] {
  const lastFallback = content.findLastIndex((b) => b.type === "fallback");
  const out: BetaContentBlockParam[] = [];
  content.forEach((block, i) => {
    const beforeBoundary = i < lastFallback;
    switch (block.type) {
      case "text":
        out.push(
          block.citations?.length
            ? { type: "text", text: block.text, citations: block.citations as BetaTextCitations }
            : { type: "text", text: block.text },
        );
        break;
      case "thinking":
        if (!beforeBoundary) out.push({ type: "thinking", thinking: block.thinking, signature: block.signature });
        break;
      case "redacted_thinking":
        if (!beforeBoundary) out.push({ type: "redacted_thinking", data: block.data });
        break;
      case "fallback":
        out.push({ type: "fallback", from: block.from, to: block.to });
        break;
      default:
        // This app uses no tools, so nothing else should appear; drop anything
        // unrecognised before the boundary and keep it as-is after it.
        if (!beforeBoundary) out.push(block as unknown as BetaContentBlockParam);
    }
  });
  return out;
}

type BetaTextCitations = Anthropic.Beta.BetaTextBlockParam["citations"];

function logTransformations(message: Anthropic.Beta.BetaMessage) {
  const transformations = (message as { input_transformations?: unknown[] }).input_transformations;
  if (Array.isArray(transformations) && transformations.length > 0) {
    console.warn("[tutor] API transformed the input:", JSON.stringify(transformations));
  }
  if (message.content.some((b) => b.type === "fallback")) {
    console.warn(`[tutor] fallback used; served by ${message.model}`);
  }
}

function toTutorError(error: unknown): TutorError {
  if (error instanceof TutorError) return error;
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new TutorError(error.message, "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.", 500);
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new TutorError(error.message, "The tutor is getting too many requests. Wait a moment and try again.", 429);
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new TutorError(error.message, "The tutor request was rejected. Check the server logs for details.", 500);
  }
  // APIConnectionError is a subclass of APIError, so check it first.
  if (error instanceof Anthropic.APIConnectionError) {
    return new TutorError(error.message, "Couldn't reach the tutor. Check your connection and try again.", 502);
  }
  if (error instanceof Anthropic.APIError) {
    return new TutorError(error.message, "The tutor is temporarily unavailable. Please try again.", 502);
  }
  return new TutorError(String(error), "Something went wrong talking to the tutor. Please try again.", 500);
}
