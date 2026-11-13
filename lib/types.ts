// Types shared by the server and the browser. Keep this file free of
// server-only imports.

export type Lang = "en" | "zh";

/** One spoken/displayed piece of a tutor reply. */
export interface SpeechSegment {
  lang: Lang;
  /** English sentence(s), or Simplified Chinese characters. */
  text: string;
  /** zh only: tone-marked pinyin, one syllable per character. "" for en. */
  pinyin: string;
  /** zh only: short English meaning. "" for en. */
  english: string;
}

export interface ChineseItem {
  hanzi: string;
  pinyin: string;
  english: string;
}

export interface TutorReply {
  speech: SpeechSegment[];
  /** Short written tip shown on screen but not spoken ("" if none). */
  on_screen_note: string;
  /** Something the learner should now say aloud, or null. */
  practice: ChineseItem | null;
  /** Chinese words/phrases taught or practised this turn. */
  vocabulary: ChineseItem[];
  /** Full replacement for the tutor's notes about the learner, or null if unchanged. */
  learner_notes: string | null;
  /** True when the learner has finished the current unit. */
  unit_complete: boolean;
}

export interface PronunciationPhoneme {
  phoneme: string;
  accuracy: number | null;
}

export interface PronunciationWord {
  text: string;
  accuracy: number | null;
  /** Azure's ErrorType: None, Mispronunciation, Omission, Insertion, ... */
  errorType: string;
  phonemes: PronunciationPhoneme[];
}

export interface PronunciationScores {
  pron: number | null;
  accuracy: number | null;
  fluency: number | null;
  completeness: number | null;
}

export interface PronunciationResult {
  attemptId: number;
  target: ChineseItem;
  recognized: string;
  scores: PronunciationScores;
  words: PronunciationWord[];
  passed: boolean;
}

/** What the UI renders for a stored message (messages.display). */
export type DisplayMessage =
  | { kind: "session_start"; unit: number }
  | { kind: "learner"; text: string; via: "voice" | "text" }
  | { kind: "attempt"; result: PronunciationResult }
  | { kind: "tutor"; reply: TutorReply; model: string };

export interface ChatMessageDTO {
  seq: number;
  role: "user" | "assistant";
  display: DisplayMessage;
  createdAt: string;
}

export interface UnitInfo {
  number: number;
  title: string;
}

// ---- API contracts ----------------------------------------------------------

export type ChatInput =
  | { type: "start" }
  | { type: "text"; text: string; via: "voice" | "text" }
  | { type: "attempt"; attemptId: number };

export interface ChatRequest {
  input: ChatInput;
  /** Start a fresh study session even if the current one is still active. */
  newSession?: boolean;
  /** IANA time zone of the browser, for dates and streaks. */
  timezone?: string;
}

export interface ChatResponse {
  conversationId: string;
  /** True when this request started a new session (the UI clears the transcript). */
  sessionStarted: boolean;
  messages: ChatMessageDTO[];
  unit: UnitInfo;
}

export interface SessionResponse {
  conversationId: string | null;
  messages: ChatMessageDTO[];
  unit: UnitInfo;
}

export interface TranscribeResponse {
  text: string;
}

export interface TtsRequest {
  segments: Array<Pick<SpeechSegment, "lang" | "text">>;
  /** Speak Chinese more slowly (English is always normal speed). */
  slowChinese: boolean;
}

export interface VocabularyDTO {
  hanzi: string;
  pinyin: string;
  english: string;
  introducedAt: string;
  practiceAttempts: number;
  practicePasses: number;
  lastScore: number | null;
  bestScore: number | null;
  intervalDays: number;
  nextReviewAt: string;
  /** Whole days until the next review; 0 or less means due now. */
  reviewInDays: number;
  strength: "new" | "learning" | "familiar" | "mastered";
}

export interface ProgressResponse {
  unit: UnitInfo;
  totalUnits: number;
  streakDays: number;
  studyDays: number;
  wordsLearned: number;
  wordsMastered: number;
  dueForReview: number;
  attempts: number;
  recentAverage: number | null;
  vocabulary: VocabularyDTO[];
  recentAttempts: Array<{
    id: number;
    createdAt: string;
    hanzi: string;
    pinyin: string;
    score: number | null;
  }>;
}

export interface ApiError {
  error: string;
}
