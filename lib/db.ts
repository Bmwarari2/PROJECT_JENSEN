import "server-only";
import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { dbEnv } from "@/lib/env";
import { scheduleAfterAttempt, strengthOf } from "@/lib/srs";
import { TOTAL_UNITS } from "@/lib/curriculum";
import type { ChineseItem, ChatMessageDTO, DisplayMessage, PronunciationWord } from "@/lib/types";

type Tables = Database["public"]["Tables"];
export type ConversationRow = Tables["conversations"]["Row"];
export type MessageRow = Tables["messages"]["Row"];
export type VocabularyRow = Tables["vocabulary"]["Row"];
export type AttemptRow = Tables["pronunciation_attempts"]["Row"];
export type LearnerStateRow = Tables["learner_state"]["Row"];

let client: SupabaseClient<Database> | undefined;

function db(): SupabaseClient<Database> {
  if (!client) {
    const env = dbEnv();
    client = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return client;
}

export class DatabaseError extends Error {
  constructor(
    action: string,
    readonly pgError: PostgrestError,
  ) {
    super(`Database error while trying to ${action}: ${pgError.message}`);
    this.name = "DatabaseError";
  }

  /** Raised by append_messages when another request appended first. */
  get isConcurrentUpdate(): boolean {
    return this.pgError.code === "40001";
  }
}

type Result = { data: unknown; error: PostgrestError | null };

/** Unwrap a query that must return data. */
function check<R extends Result>(action: string, result: R): NonNullable<R["data"]> {
  if (result.error) throw new DatabaseError(action, result.error);
  if (result.data === null || result.data === undefined) {
    throw new DatabaseError(action, {
      name: "PostgrestError",
      message: "no data returned",
      code: "PGRST116",
      details: "",
      hint: "",
    } as PostgrestError);
  }
  return result.data as NonNullable<R["data"]>;
}

/** Unwrap a query that may legitimately return nothing (maybeSingle, updates, void RPCs). */
function checkMaybe<R extends Result>(action: string, result: R): R["data"] | null {
  if (result.error) throw new DatabaseError(action, result.error);
  return result.data ?? null;
}

// ---- Learner state ----------------------------------------------------------

export async function getLearnerState(): Promise<LearnerStateRow> {
  const row = checkMaybe(
    "load your learner profile",
    await db().from("learner_state").select("*").eq("id", 1).maybeSingle(),
  );
  // The migration seeds this row; recreate it if someone deleted it.
  if (!row) {
    return check(
      "create your learner profile",
      await db().from("learner_state").upsert({ id: 1 }).select("*").single(),
    );
  }
  return row;
}

export async function updateLearnerState(patch: { tutorNotes?: string; advanceUnit?: boolean }) {
  if (patch.tutorNotes === undefined && !patch.advanceUnit) return;
  const state = await getLearnerState();
  const update: Tables["learner_state"]["Update"] = { updated_at: new Date().toISOString() };
  if (patch.tutorNotes !== undefined) update.tutor_notes = patch.tutorNotes.slice(0, 4000);
  if (patch.advanceUnit) update.current_unit = Math.min(state.current_unit + 1, TOTAL_UNITS);
  checkMaybe("save your learner profile", await db().from("learner_state").update(update).eq("id", 1));
}

// ---- Conversations ----------------------------------------------------------

export async function getLatestConversation(): Promise<ConversationRow | null> {
  return checkMaybe(
    "load your current session",
    await db()
      .from("conversations")
      .select("*")
      .order("last_message_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  );
}

export async function createConversation(input: { model: string; systemPrompt: string }): Promise<ConversationRow> {
  return check(
    "start a new session",
    await db()
      .from("conversations")
      .insert({ model: input.model, system_prompt: input.systemPrompt })
      .select("*")
      .single(),
  );
}

/** Sessions that actually got going (at least one exchange). */
export async function countConversations(): Promise<number> {
  const result = await db()
    .from("conversations")
    .select("id", { count: "exact", head: true })
    .gt("message_count", 0);
  if (result.error) throw new DatabaseError("count your sessions", result.error);
  return result.count ?? 0;
}

export async function getMessages(conversationId: string): Promise<MessageRow[]> {
  return check(
    "load the conversation",
    await db().from("messages").select("*").eq("conversation_id", conversationId).order("seq"),
  );
}

export interface NewMessage {
  role: "user" | "assistant";
  content: Json;
  display: DisplayMessage;
}

/**
 * Append turns atomically. `expectedCount` is the message count the caller's
 * Claude request was built from; throws a DatabaseError with
 * `isConcurrentUpdate` if someone else appended first.
 */
export async function appendMessages(conversationId: string, expectedCount: number, messages: NewMessage[]) {
  check(
    "save the conversation",
    await db().rpc("append_messages", {
      p_conversation_id: conversationId,
      p_expected_count: expectedCount,
      p_messages: messages as unknown as Json,
    }),
  );
}

export function toMessageDTO(row: Pick<MessageRow, "seq" | "role" | "display" | "created_at">): ChatMessageDTO {
  return {
    seq: row.seq,
    role: row.role,
    display: row.display as unknown as DisplayMessage,
    createdAt: row.created_at,
  };
}

// ---- Vocabulary -------------------------------------------------------------

export async function recordVocabulary(items: ChineseItem[]) {
  const clean = items
    .map((i) => ({ hanzi: i.hanzi.trim(), pinyin: i.pinyin.trim(), english: i.english.trim() }))
    .filter((i) => i.hanzi.length > 0 && i.hanzi.length <= 40);
  if (clean.length === 0) return;
  checkMaybe("save new words", await db().rpc("record_vocabulary", { items: clean as unknown as Json }));
}

export async function listVocabulary(): Promise<VocabularyRow[]> {
  return check(
    "load your vocabulary",
    await db().from("vocabulary").select("*").order("introduced_at", { ascending: false }).limit(2000),
  );
}

// ---- Pronunciation ----------------------------------------------------------

export interface NewAttempt {
  conversationId: string | null;
  target: ChineseItem;
  recognized: string;
  scores: { pron: number | null; accuracy: number | null; fluency: number | null; completeness: number | null };
  words: PronunciationWord[];
}

/** Save an attempt and reschedule the practised word. Returns the attempt id and pass/fail. */
export async function recordAttempt(attempt: NewAttempt): Promise<{ id: number; passed: boolean }> {
  const inserted = check(
    "save your pronunciation attempt",
    await db()
      .from("pronunciation_attempts")
      .insert({
        conversation_id: attempt.conversationId,
        target_hanzi: attempt.target.hanzi,
        target_pinyin: attempt.target.pinyin,
        target_english: attempt.target.english,
        recognized_text: attempt.recognized,
        pron_score: attempt.scores.pron,
        accuracy_score: attempt.scores.accuracy,
        fluency_score: attempt.scores.fluency,
        completeness_score: attempt.scores.completeness,
        words: attempt.words as unknown as Json,
      })
      .select("id")
      .single(),
  );

  // Make sure the practised item is in the vocabulary, then reschedule it.
  await recordVocabulary([attempt.target]);
  const word = checkMaybe(
    "load the practised word",
    await db().from("vocabulary").select("*").eq("hanzi", attempt.target.hanzi.trim()).maybeSingle(),
  );
  const score = attempt.scores.pron;
  const next = scheduleAfterAttempt({ intervalDays: word?.interval_days ?? 0 }, score);
  if (word) {
    checkMaybe(
      "update the word's review schedule",
      await db()
        .from("vocabulary")
        .update({
          practice_attempts: word.practice_attempts + 1,
          practice_passes: word.practice_passes + (next.passed ? 1 : 0),
          last_score: score,
          best_score: score === null ? word.best_score : Math.max(score, word.best_score ?? 0),
          interval_days: next.intervalDays,
          next_review_at: next.nextReviewAt.toISOString(),
          last_seen_at: new Date().toISOString(),
        })
        .eq("id", word.id),
    );
  }
  return { id: inserted.id, passed: next.passed };
}

export async function getAttempt(id: number): Promise<AttemptRow | null> {
  return checkMaybe(
    "load your pronunciation attempt",
    await db().from("pronunciation_attempts").select("*").eq("id", id).maybeSingle(),
  );
}

export async function listRecentAttempts(limit: number): Promise<AttemptRow[]> {
  return check(
    "load recent attempts",
    await db().from("pronunciation_attempts").select("*").order("created_at", { ascending: false }).limit(limit),
  );
}

export async function countAttempts(): Promise<number> {
  const result = await db().from("pronunciation_attempts").select("id", { count: "exact", head: true });
  if (result.error) throw new DatabaseError("count your attempts", result.error);
  return result.count ?? 0;
}

// ---- Activity ---------------------------------------------------------------

/** Distinct local study dates (YYYY-MM-DD), newest first. */
export async function activityDays(timezone: string): Promise<string[]> {
  const rows = check("load your study history", await db().rpc("activity_days", { tz: timezone }));
  return (rows ?? []).map((r) => r.day);
}

export function vocabStrength(row: Pick<VocabularyRow, "interval_days" | "practice_attempts">) {
  return strengthOf(row.interval_days, row.practice_attempts);
}
