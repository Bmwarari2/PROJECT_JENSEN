"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChineseText } from "@/components/ChineseText";
import { BackIcon } from "@/components/Icons";
import { scoreClass } from "@/components/Messages";
import { api } from "@/lib/client/api";
import { player } from "@/lib/client/player";
import { useSettings } from "@/lib/client/settings";
import type { ProgressResponse, VocabularyDTO } from "@/lib/types";

type Filter = "all" | "due" | VocabularyDTO["strength"];

const STRENGTH_LABEL: Record<VocabularyDTO["strength"], string> = {
  new: "New",
  learning: "Learning",
  familiar: "Familiar",
  mastered: "Mastered",
};

function relativeDays(days: number): string {
  if (days <= 0) return "due now";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

export default function ProgressPage() {
  const [settings] = useSettings();
  const [data, setData] = useState<ProgressResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [playingKey, setPlayingKey] = useState<string | null>(null);

  useEffect(() => player.subscribe(setPlayingKey), []);
  useEffect(() => {
    api
      .progress()
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const words = useMemo(() => {
    if (!data) return [];
    return data.vocabulary.filter((v) =>
      filter === "all" ? true : filter === "due" ? v.reviewInDays <= 0 : v.strength === filter,
    );
  }, [data, filter]);

  return (
    <div className="page">
      <header className="topbar">
        <Link href="/" className="icon-btn" aria-label="Back to lesson">
          <BackIcon />
        </Link>
        <h1 className="page-title">Your progress</h1>
      </header>

      <main className="page-body">
        {error && (
          <p className="toast" role="alert">
            {error}
          </p>
        )}
        {!data && !error && <div className="center-note">Loading…</div>}
        {data && (
          <>
            <section className="unit-progress">
              <div className="unit-progress-head">
                <span>
                  Unit {data.unit.number} of {data.totalUnits}
                </span>
                <strong>{data.unit.title}</strong>
              </div>
              <div
                className="bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={data.totalUnits}
                aria-valuenow={data.unit.number - 1}
              >
                <span style={{ width: `${((data.unit.number - 1) / data.totalUnits) * 100}%` }} />
              </div>
            </section>

            <section className="stats">
              <Stat value={data.streakDays} label="day streak" accent />
              <Stat value={data.wordsLearned} label="words learned" />
              <Stat value={data.wordsMastered} label="mastered" />
              <Stat value={data.dueForReview} label="due for review" />
              <Stat
                value={data.recentAverage === null ? "–" : Math.round(data.recentAverage)}
                label="recent pronunciation"
              />
              <Stat value={data.studyDays} label="days studied" />
            </section>

            <section>
              <div className="section-head">
                <h2>Vocabulary</h2>
                <div className="filters" role="tablist">
                  {(["all", "due", "learning", "familiar", "mastered"] as Filter[]).map((f) => (
                    <button
                      key={f}
                      type="button"
                      role="tab"
                      aria-selected={filter === f}
                      className={`chip${filter === f ? " is-active" : ""}`}
                      onClick={() => setFilter(f)}
                    >
                      {f === "all" ? "All" : f === "due" ? "Due" : STRENGTH_LABEL[f]}
                    </button>
                  ))}
                </div>
              </div>
              {data.vocabulary.length === 0 ? (
                <p className="empty">Words you learn in lessons will appear here.</p>
              ) : words.length === 0 ? (
                <p className="empty">Nothing here right now.</p>
              ) : (
                <ul className="vocab">
                  {words.map((w) => {
                    const key = `vocab:${w.hanzi}`;
                    return (
                      <li key={w.hanzi}>
                        <button
                          type="button"
                          className={`vocab-word${playingKey === key ? " is-playing" : ""}`}
                          onClick={() => {
                            player.unlock();
                            void player.play(key, [{ lang: "zh", text: w.hanzi }], settings.slowChinese);
                          }}
                          title="Listen"
                        >
                          <ChineseText hanzi={w.hanzi} pinyin={w.pinyin} size="md" />
                        </button>
                        <div className="vocab-meta">
                          <span className="vocab-english">{w.english}</span>
                          <span className="vocab-sub">
                            <span className={`badge badge-${w.strength}`}>{STRENGTH_LABEL[w.strength]}</span>
                            {w.bestScore !== null && <span>best {Math.round(w.bestScore)}</span>}
                            <span>review {relativeDays(w.reviewInDays)}</span>
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {data.recentAttempts.length > 0 && (
              <section>
                <div className="section-head">
                  <h2>Recent pronunciation</h2>
                  <span className="muted">{data.attempts} attempts in total</span>
                </div>
                <ul className="attempts">
                  {data.recentAttempts.map((a) => (
                    <li key={a.id}>
                      <ChineseText hanzi={a.hanzi} pinyin={a.pinyin} size="sm" />
                      <span className="muted">
                        {new Date(a.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                      </span>
                      <span className={`score-pill ${scoreClass(a.score)}`}>
                        {a.score === null ? "–" : Math.round(a.score)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Stat({ value, label, accent }: { value: number | string; label: string; accent?: boolean }) {
  return (
    <div className={`stat${accent ? " stat-accent" : ""}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
