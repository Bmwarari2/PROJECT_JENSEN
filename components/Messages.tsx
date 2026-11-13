"use client";

import { ChineseText } from "@/components/ChineseText";
import { MicIcon, SpeakerIcon } from "@/components/Icons";
import type { PronunciationResult, SpeechSegment, TutorReply } from "@/lib/types";

export function scoreClass(score: number | null): string {
  if (score === null) return "score-none";
  if (score >= 85) return "score-great";
  if (score >= 70) return "score-good";
  if (score >= 50) return "score-fair";
  return "score-poor";
}

export function scoreLabel(score: number | null): string {
  if (score === null) return "No score";
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Good";
  if (score >= 50) return "Getting there";
  return "Try again";
}

export function TutorMessage({
  id,
  reply,
  showPinyin,
  playingKey,
  onPlayAll,
  onPlayItem,
}: {
  id: string;
  reply: TutorReply;
  showPinyin: boolean;
  playingKey: string | null;
  onPlayAll: () => void;
  onPlayItem: (key: string, segment: SpeechSegment) => void;
}) {
  const playingAll = playingKey === id;
  return (
    <div className="msg msg-tutor">
      <div className="avatar" aria-hidden="true">
        师
      </div>
      <div className="bubble bubble-tutor">
        <div className="speech">
          {reply.speech.map((segment, i) => {
            if (segment.lang === "en") {
              return (
                <span key={i} className="speech-en">
                  {segment.text}{" "}
                </span>
              );
            }
            const key = `${id}:${i}`;
            return (
              <button
                key={i}
                type="button"
                className={`zh-chip${playingKey === key ? " is-playing" : ""}`}
                onClick={() => onPlayItem(key, segment)}
                title={`Hear "${segment.text}" again`}
              >
                <ChineseText hanzi={segment.text} pinyin={segment.pinyin} showPinyin={showPinyin} size="lg" />
                {segment.english && <span className="zh-chip-gloss">{segment.english}</span>}
              </button>
            );
          })}
        </div>
        {reply.on_screen_note && <p className="note">{reply.on_screen_note}</p>}
        <button
          type="button"
          className={`replay${playingAll ? " is-playing" : ""}`}
          onClick={onPlayAll}
          aria-label={playingAll ? "Playing" : "Play this message"}
        >
          <SpeakerIcon size={16} />
          <span>{playingAll ? "Playing…" : "Listen"}</span>
        </button>
      </div>
    </div>
  );
}

export function LearnerMessage({ text, via, pending }: { text: string; via: "voice" | "text"; pending?: boolean }) {
  return (
    <div className={`msg msg-learner${pending ? " is-pending" : ""}`}>
      <div className="bubble bubble-learner">
        {via === "voice" && (
          <span className="via" title="Spoken">
            <MicIcon size={13} />
          </span>
        )}
        {text}
      </div>
    </div>
  );
}

export function AttemptMessage({ result, showPinyin }: { result: PronunciationResult; showPinyin: boolean }) {
  const score = result.scores.pron;
  return (
    <div className="msg msg-learner">
      <div className="bubble bubble-attempt">
        <div className="attempt-head">
          <div className={`score-ring ${scoreClass(score)}`}>
            <span>{score === null ? "–" : Math.round(score)}</span>
          </div>
          <div className="attempt-target">
            <ChineseText hanzi={result.target.hanzi} pinyin={result.target.pinyin} showPinyin={showPinyin} size="md" />
            <span className="attempt-label">{scoreLabel(score)}</span>
          </div>
        </div>
        {result.words.length > 0 && (
          <div className="attempt-words">
            {result.words.map((w, i) => (
              <span
                key={i}
                className={`word-score ${scoreClass(w.accuracy)}`}
                title={w.errorType !== "None" ? w.errorType : undefined}
              >
                <span lang="zh-CN">{w.text}</span>
                <small>{w.errorType === "Omission" ? "missed" : w.accuracy === null ? "–" : Math.round(w.accuracy)}</small>
              </span>
            ))}
          </div>
        )}
        {result.recognized && result.recognized.replace(/[。！？，.!?,\s]/g, "") !== result.target.hanzi && (
          <p className="attempt-heard">
            Heard: <span lang="zh-CN">{result.recognized}</span>
          </p>
        )}
      </div>
    </div>
  );
}

export function SessionDivider({ unit, title, date }: { unit: number; title: string; date: string }) {
  return (
    <div className="divider" role="separator">
      <span>
        New lesson · {date} · Unit {unit}: {title}
      </span>
    </div>
  );
}

export function Thinking({ label }: { label: string }) {
  return (
    <div className="msg msg-tutor" aria-live="polite">
      <div className="avatar" aria-hidden="true">
        师
      </div>
      <div className="bubble bubble-tutor thinking">
        <span className="dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="thinking-label">{label}</span>
      </div>
    </div>
  );
}
