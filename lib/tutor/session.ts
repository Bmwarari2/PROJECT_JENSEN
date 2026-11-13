import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { claudeEnv } from "@/lib/env";
import { unitInfo } from "@/lib/curriculum";
import {
  appendMessages,
  countConversations,
  createConversation,
  getAttempt,
  getLatestConversation,
  getLearnerState,
  getMessages,
  listRecentAttempts,
  listVocabulary,
  recordVocabulary,
  toMessageDTO,
  updateLearnerState,
  vocabStrength,
  type ConversationRow,
  type MessageRow,
} from "@/lib/db";
import type { Json } from "@/lib/database.types";
import { describeDate, localDate, safeTimezone } from "@/lib/time";
import { attemptMessage, learnerTextMessage, sessionStartMessage } from "@/lib/tutor/format";
import { buildSystemPrompt, type LearnerSnapshot } from "@/lib/tutor/prompt";
import { runTutorTurn, TutorError } from "@/lib/tutor/engine";
import { attemptRowToResult } from "@/lib/speech/pronunciation";
import type { ChatMessageDTO, ChatRequest, ChatResponse, DisplayMessage, SessionResponse } from "@/lib/types";

/**
 * A study session is one Claude conversation. A new one starts after a break
 * (or when a session gets long), with a fresh snapshot of your progress in its
 * system prompt. Within a session the history is strictly append-only, which
 * keeps Claude's reasoning valid across turns and the prompt cache warm.
 */
const SESSION_IDLE_MS = 3 * 60 * 60 * 1000;
const MAX_SESSION_MESSAGES = 120;

export function isSessionActive(conversation: ConversationRow, now = Date.now()): boolean {
  return (
    now - Date.parse(conversation.last_message_at) < SESSION_IDLE_MS &&
    conversation.message_count < MAX_SESSION_MESSAGES
  );
}

async function activeConversation(): Promise<ConversationRow | null> {
  const latest = await getLatestConversation();
  return latest && isSessionActive(latest) ? latest : null;
}

export async function loadSession(): Promise<SessionResponse> {
  const [conversation, state] = await Promise.all([activeConversation(), getLearnerState()]);
  const messages = conversation ? await getMessages(conversation.id) : [];
  return {
    conversationId: conversation?.id ?? null,
    messages: messages.map(toMessageDTO),
    unit: unitInfo(state.current_unit),
  };
}

async function buildSnapshot(timezone: string): Promise<LearnerSnapshot> {
  const now = new Date();
  const [state, vocab, attempts, sessionCount, latest] = await Promise.all([
    getLearnerState(),
    listVocabulary(),
    listRecentAttempts(20),
    countConversations(),
    getLatestConversation(),
  ]);

  const due = vocab
    .filter((v) => Date.parse(v.next_review_at) <= now.getTime())
    .sort((a, b) => Date.parse(a.next_review_at) - Date.parse(b.next_review_at))
    .slice(0, 8);

  const scored = attempts.filter((a) => a.pron_score !== null).slice(0, 10);
  const recentAverage = scored.length
    ? scored.reduce((sum, a) => sum + (a.pron_score ?? 0), 0) / scored.length
    : null;

  // Weakest recent items: latest score per item, below the pass mark.
  const latestByItem = new Map<string, number>();
  for (const a of attempts) {
    if (a.pron_score !== null && !latestByItem.has(a.target_hanzi)) latestByItem.set(a.target_hanzi, a.pron_score);
  }
  const weakest = [...latestByItem]
    .filter(([, score]) => score < 70)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 3)
    .map(([hanzi, score]) => ({ hanzi, score }));

  return {
    now: describeDate(now, timezone),
    sessionCount,
    lastSessionDate: latest ? localDate(new Date(latest.last_message_at), timezone) : null,
    currentUnit: state.current_unit,
    tutorNotes: state.tutor_notes,
    wordsLearned: vocab.map((v) => ({
      hanzi: v.hanzi,
      pinyin: v.pinyin,
      english: v.english,
      strength: vocabStrength(v),
    })),
    dueForReview: due.map((v) => ({ hanzi: v.hanzi, pinyin: v.pinyin, english: v.english, lastScore: v.last_score })),
    recentAverage,
    weakest,
  };
}

async function startConversation(timezone: string): Promise<ConversationRow> {
  const snapshot = await buildSnapshot(timezone);
  return createConversation({ model: claudeEnv().TUTOR_MODEL, systemPrompt: buildSystemPrompt(snapshot) });
}

function toHistory(rows: MessageRow[]): Anthropic.Beta.BetaMessageParam[] {
  // Stored exactly as sent/received, so it goes back unchanged.
  return rows.map((row) => ({ role: row.role, content: row.content }) as unknown as Anthropic.Beta.BetaMessageParam);
}

export async function runChatTurn(request: ChatRequest): Promise<ChatResponse> {
  const timezone = safeTimezone(request.timezone);
  const { input } = request;

  // "start" always opens a fresh session; other input continues the active
  // one, or opens a new one if you've been away.
  let conversation = input.type === "start" || request.newSession ? null : await activeConversation();
  const sessionStarted = conversation === null;
  conversation ??= await startConversation(timezone);

  const [history, state] = await Promise.all([getMessages(conversation.id), getLearnerState()]);

  let userContent: string;
  let userDisplay: DisplayMessage;
  switch (input.type) {
    case "start":
      userContent = sessionStartMessage();
      userDisplay = { kind: "session_start", unit: state.current_unit };
      break;
    case "text":
      userContent = learnerTextMessage(input.text, input.via);
      userDisplay = { kind: "learner", text: input.text.trim(), via: input.via };
      break;
    case "attempt": {
      const row = await getAttempt(input.attemptId);
      if (!row) throw new TutorError(`Attempt ${input.attemptId} not found`, "That recording wasn't found.", 404);
      const result = attemptRowToResult(row);
      userContent = attemptMessage(result);
      userDisplay = { kind: "attempt", result };
      break;
    }
  }

  const turn = await runTutorTurn({
    systemPrompt: conversation.system_prompt,
    history: toHistory(history),
    userContent,
  });

  const assistantDisplay: DisplayMessage = { kind: "tutor", reply: turn.reply, model: turn.model };
  await appendMessages(conversation.id, history.length, [
    { role: "user", content: userContent, display: userDisplay },
    { role: "assistant", content: turn.assistantContent as unknown as Json, display: assistantDisplay },
  ]);

  // Progress bookkeeping shouldn't cost you the reply if it fails.
  const { reply } = turn;
  const bookkeeping = await Promise.allSettled([
    recordVocabulary(reply.practice ? [...reply.vocabulary, reply.practice] : reply.vocabulary),
    updateLearnerState({
      tutorNotes: reply.learner_notes ?? undefined,
      advanceUnit: reply.unit_complete,
    }),
  ]);
  for (const outcome of bookkeeping) {
    if (outcome.status === "rejected") console.error("[tutor] progress update failed:", outcome.reason);
  }

  const createdAt = new Date().toISOString();
  const messages: ChatMessageDTO[] = [
    { seq: history.length + 1, role: "user", display: userDisplay, createdAt },
    { seq: history.length + 2, role: "assistant", display: assistantDisplay, createdAt },
  ];
  const unitNumber = reply.unit_complete ? state.current_unit + 1 : state.current_unit;
  return { conversationId: conversation.id, sessionStarted, messages, unit: unitInfo(unitNumber) };
}
