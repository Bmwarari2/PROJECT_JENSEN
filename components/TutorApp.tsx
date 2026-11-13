"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ChineseText } from "@/components/ChineseText";
import { ChartIcon, CloseIcon, MenuIcon, SendIcon, SpeakerIcon } from "@/components/Icons";
import { AttemptMessage, LearnerMessage, SessionDivider, Thinking, TutorMessage } from "@/components/Messages";
import { MicButton } from "@/components/MicButton";
import { api, ApiError } from "@/lib/client/api";
import { player } from "@/lib/client/player";
import { Recorder } from "@/lib/client/recorder";
import { useSettings } from "@/lib/client/settings";
import { unitInfo } from "@/lib/curriculum";
import type { ChatMessageDTO, ChatResponse, ChineseItem, SpeechSegment, TutorReply, UnitInfo } from "@/lib/types";

type Busy = null | "thinking" | "transcribing" | "scoring";
type RecordingMode = null | "talk" | "practice";

const MAX_TALK_SECONDS = 55;
const MAX_PRACTICE_SECONDS = 25;

const QUICK_REPLIES = [
  "Teach me something new",
  "Let's review my words",
  "Can you say that more slowly?",
  "What does that mean?",
];

const BUSY_LABELS: Record<Exclude<Busy, null>, string> = {
  thinking: "Lǎoshī is thinking…",
  transcribing: "Listening back…",
  scoring: "Checking your pronunciation…",
};

function messageKey(m: ChatMessageDTO) {
  return `m${m.seq}`;
}

const noopSubscribe = () => () => undefined;

function findLastTutor(messages: ChatMessageDTO[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.display.kind === "tutor") return { message: m, reply: m.display.reply, isLast: i === messages.length - 1 };
  }
  return null;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

export function TutorApp() {
  const [settings, updateSettings] = useSettings();
  const [loading, setLoading] = useState(true);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageDTO[]>([]);
  const [pending, setPending] = useState<ChatMessageDTO | null>(null);
  const [unit, setUnit] = useState<UnitInfo | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [recording, setRecording] = useState<RecordingMode>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [dismissedPractice, setDismissedPractice] = useState<number | null>(null);
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [recorder, setRecorder] = useState<Recorder | null>(null);
  // Checked after hydration (the server can't know); assume yes until then.
  const micSupported = useSyncExternalStore(noopSubscribe, Recorder.isSupported, () => true);

  const autoStopRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => player.subscribe(setPlayingKey), []);

  // Load the active session, if any.
  useEffect(() => {
    let cancelled = false;
    api
      .session()
      .then((s) => {
        if (cancelled) return;
        setConversationId(s.conversationId);
        setMessages(s.messages);
        setUnit(s.unit);
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the newest message in view.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending, busy]);

  const lastTutor = findLastTutor(messages);

  const practice: ChineseItem | null =
    lastTutor?.isLast && lastTutor.reply.practice && dismissedPractice !== lastTutor.message.seq
      ? lastTutor.reply.practice
      : null;

  const playReply = useCallback((key: string, reply: TutorReply) => {
    player
      .play(key, reply.speech.map(({ lang, text }) => ({ lang, text })), settingsRef.current.slowChinese)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn't play audio."));
  }, []);

  const playSegment = useCallback((key: string, segment: Pick<SpeechSegment, "lang" | "text">) => {
    player
      .play(key, [{ lang: segment.lang, text: segment.text }], settingsRef.current.slowChinese)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn't play audio."));
  }, []);

  const applyChatResponse = useCallback(
    (response: ChatResponse) => {
      setConversationId(response.conversationId);
      setUnit(response.unit);
      setMessages((prev) => (response.sessionStarted ? response.messages : [...prev, ...response.messages]));
      const tutor = response.messages.findLast((m) => m.display.kind === "tutor");
      if (tutor && tutor.display.kind === "tutor" && settingsRef.current.autoplay) {
        playReply(messageKey(tutor), tutor.display.reply);
      }
    },
    [playReply],
  );

  const sendChat = useCallback(
    async (request: Parameters<typeof api.chat>[0], optimistic: ChatMessageDTO | null) => {
      setError(null);
      setPending(optimistic);
      setBusy("thinking");
      try {
        applyChatResponse(await api.chat(request));
        return true;
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
        if (e instanceof ApiError && e.status === 409) {
          // Someone else (another tab?) moved the conversation on: reload it.
          api.session().then((s) => setMessages(s.messages)).catch(() => undefined);
        }
        return false;
      } finally {
        setPending(null);
        setBusy(null);
      }
    },
    [applyChatResponse],
  );

  const startLesson = useCallback(
    (fresh: boolean) => {
      player.unlock();
      player.stop();
      setMenuOpen(false);
      setDismissedPractice(null);
      if (fresh) setMessages([]);
      void sendChat({ input: { type: "start" }, newSession: true }, null);
    },
    [sendChat],
  );

  const sendText = useCallback(
    async (text: string, via: "voice" | "text") => {
      const clean = text.trim();
      if (!clean) return;
      player.unlock();
      player.stop();
      const optimistic: ChatMessageDTO = {
        seq: -1,
        role: "user",
        display: { kind: "learner", text: clean, via },
        createdAt: new Date().toISOString(),
      };
      const ok = await sendChat({ input: { type: "text", text: clean, via } }, optimistic);
      if (!ok && via === "text") setDraft(clean); // give the text back so it isn't lost
    },
    [sendChat],
  );

  // ---- Recording --------------------------------------------------------------

  const clearAutoStop = () => {
    if (autoStopRef.current !== null) window.clearTimeout(autoStopRef.current);
    autoStopRef.current = null;
  };

  const stopRecording = useCallback(async () => {
    clearAutoStop();
    const mode = recording;
    if (!recorder || !mode) return;
    setRecording(null);
    setRecorder(null);

    let wav: Blob;
    try {
      wav = await recorder.stop();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Recording failed.");
      return;
    }

    if (mode === "talk") {
      setBusy("transcribing");
      try {
        const { text } = await api.transcribe(wav);
        setBusy(null);
        if (!text.trim()) {
          setError("I didn't catch that. Try again, a little closer to the mic.");
          return;
        }
        await sendText(text, "voice");
      } catch (e) {
        setBusy(null);
        setError(e instanceof Error ? e.message : "Couldn't transcribe that.");
      }
      return;
    }

    // Practice: score it, show the result, then let the tutor respond.
    const target = practice;
    if (!target) return;
    setBusy("scoring");
    try {
      const result = await api.pronounce(wav, target, conversationId);
      setBusy(null);
      const optimistic: ChatMessageDTO = {
        seq: -1,
        role: "user",
        display: { kind: "attempt", result },
        createdAt: new Date().toISOString(),
      };
      await sendChat({ input: { type: "attempt", attemptId: result.attemptId } }, optimistic);
    } catch (e) {
      setBusy(null);
      setError(e instanceof Error ? e.message : "Couldn't check that recording.");
    }
  }, [recorder, recording, practice, conversationId, sendText, sendChat]);

  // The auto-stop timer always calls the latest stopRecording.
  const stopRef = useRef(stopRecording);
  useEffect(() => {
    stopRef.current = stopRecording;
  }, [stopRecording]);

  const startRecording = useCallback(
    async (mode: Exclude<RecordingMode, null>) => {
      player.unlock();
      player.stop();
      setError(null);
      const next = new Recorder();
      try {
        await next.start();
      } catch (e) {
        const denied = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError");
        setError(
          denied
            ? "Microphone access was blocked. Allow it in your browser's site settings, then try again."
            : "Couldn't start the microphone.",
        );
        return;
      }
      setRecorder(next);
      setRecording(mode);
      const limit = mode === "talk" ? MAX_TALK_SECONDS : MAX_PRACTICE_SECONDS;
      autoStopRef.current = window.setTimeout(() => void stopRef.current(), limit * 1000);
    },
    [],
  );

  const toggleRecording = useCallback(
    (mode: Exclude<RecordingMode, null>) => {
      if (recording === mode) void stopRecording();
      else if (!recording && !busy) void startRecording(mode);
    },
    [recording, busy, startRecording, stopRecording],
  );

  // Release the mic if the component goes away mid-recording.
  const liveRecorder = useRef<Recorder | null>(null);
  useEffect(() => {
    liveRecorder.current = recorder;
  }, [recorder]);
  useEffect(
    () => () => {
      if (autoStopRef.current !== null) window.clearTimeout(autoStopRef.current);
      liveRecorder.current?.cancel();
    },
    [],
  );

  // ---- Render -------------------------------------------------------------------

  const hasConversation = messages.length > 0 || pending !== null || busy !== null;
  const canInteract = !busy && !recording;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" lang="zh-CN">
            老师
          </span>
          <span className="brand-name">Lǎoshī</span>
        </div>
        {unit && (
          <span className="unit-chip" title={`Unit ${unit.number}: ${unit.title}`}>
            Unit {unit.number} · {unit.title}
          </span>
        )}
        <nav className="topbar-actions">
          <Link href="/progress" className="icon-btn" aria-label="Your progress">
            <ChartIcon />
          </Link>
          <button
            type="button"
            className="icon-btn"
            aria-label="Menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <MenuIcon />
          </button>
        </nav>
        {menuOpen && (
          <div className="menu" role="menu">
            <button type="button" role="menuitem" onClick={() => startLesson(true)} disabled={!canInteract}>
              Start a new lesson
            </button>
            <label className="menu-toggle">
              <input
                type="checkbox"
                checked={settings.autoplay}
                onChange={(e) => updateSettings({ autoplay: e.target.checked })}
              />
              Read replies aloud
            </label>
            <label className="menu-toggle">
              <input
                type="checkbox"
                checked={settings.slowChinese}
                onChange={(e) => updateSettings({ slowChinese: e.target.checked })}
              />
              Slow Chinese
            </label>
            <label className="menu-toggle">
              <input
                type="checkbox"
                checked={settings.showPinyin}
                onChange={(e) => updateSettings({ showPinyin: e.target.checked })}
              />
              Show pinyin
            </label>
            <button
              type="button"
              role="menuitem"
              onClick={() => api.logout().finally(() => window.location.replace(new URL("/login", window.location.origin)))}
            >
              Sign out
            </button>
          </div>
        )}
      </header>

      <main className="transcript" ref={scrollRef} onClick={() => menuOpen && setMenuOpen(false)}>
        {loading ? (
          <div className="center-note">Loading…</div>
        ) : !hasConversation ? (
          <section className="welcome">
            <div className="welcome-mark" lang="zh-CN">
              你好
            </div>
            <p className="welcome-pinyin">nǐ hǎo</p>
            <h1>Ready for today&apos;s Mandarin?</h1>
            {unit && (
              <p className="welcome-unit">
                You&apos;re on unit {unit.number}: {unit.title}
              </p>
            )}
            <button type="button" className="primary-btn" onClick={() => startLesson(false)}>
              Start lesson
            </button>
            <p className="welcome-hint">
              Talk to your tutor in English or Chinese. Tap the mic, speak, then tap again to send.
            </p>
          </section>
        ) : (
          <div className="messages">
            {[...messages, ...(pending ? [pending] : [])].map((m) => {
              const key = m.seq === -1 ? "pending" : messageKey(m);
              switch (m.display.kind) {
                case "session_start":
                  return (
                    <SessionDivider
                      key={key}
                      unit={m.display.unit}
                      title={unitInfo(m.display.unit).title}
                      date={formatDate(m.createdAt)}
                    />
                  );
                case "learner":
                  return <LearnerMessage key={key} text={m.display.text} via={m.display.via} pending={m.seq === -1} />;
                case "attempt":
                  return <AttemptMessage key={key} result={m.display.result} showPinyin={settings.showPinyin} />;
                case "tutor": {
                  const reply = m.display.reply;
                  return (
                    <TutorMessage
                      key={key}
                      id={key}
                      reply={reply}
                      showPinyin={settings.showPinyin}
                      playingKey={playingKey}
                      onPlayAll={() => {
                        player.unlock();
                        if (playingKey === key) player.stop();
                        else playReply(key, reply);
                      }}
                      onPlayItem={(itemKey, segment) => {
                        player.unlock();
                        playSegment(itemKey, segment);
                      }}
                    />
                  );
                }
              }
            })}
            {busy && <Thinking label={BUSY_LABELS[busy]} />}
          </div>
        )}
      </main>

      <footer className="dock">
        {error && (
          <div className="toast" role="alert">
            <span>{error}</span>
            <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setError(null)}>
              <CloseIcon size={16} />
            </button>
          </div>
        )}

        {practice && !busy && (
          <section className="practice" aria-label="Pronunciation practice">
            <div className="practice-head">
              <span className="practice-kicker">Your turn: say</span>
              <button
                type="button"
                className="link-btn"
                onClick={() => lastTutor && setDismissedPractice(lastTutor.message.seq)}
                disabled={recording === "practice"}
              >
                Skip
              </button>
            </div>
            <div className="practice-body">
              <button
                type="button"
                className={`practice-target${playingKey === "practice" ? " is-playing" : ""}`}
                onClick={() => {
                  player.unlock();
                  playSegment("practice", { lang: "zh", text: practice.hanzi });
                }}
                title="Listen again"
              >
                <ChineseText hanzi={practice.hanzi} pinyin={practice.pinyin} showPinyin size="xl" />
                <span className="practice-english">
                  <SpeakerIcon size={14} /> {practice.english}
                </span>
              </button>
              <div className="practice-mic">
                <MicButton
                  recording={recording === "practice"}
                  disabled={!micSupported || (recording !== null && recording !== "practice")}
                  recorder={recorder}
                  onClick={() => toggleRecording("practice")}
                  label={recording === "practice" ? "Stop and check" : "Record yourself"}
                  size="md"
                />
                <span className="mic-caption">{recording === "practice" ? "Tap when done" : "Record"}</span>
              </div>
            </div>
          </section>
        )}

        {hasConversation && canInteract && !practice && (
          <div className="chips">
            {QUICK_REPLIES.map((q) => (
              <button key={q} type="button" className="chip" onClick={() => void sendText(q, "text")}>
                {q}
              </button>
            ))}
          </div>
        )}

        {hasConversation && (
          <div className="composer">
            <form
              className="composer-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (!canInteract) return;
                const text = draft;
                setDraft("");
                void sendText(text, "text");
              }}
            >
              <input
                className="composer-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={recording === "talk" ? "Listening…" : "Type in English or 中文…"}
                maxLength={2000}
                disabled={recording !== null}
                aria-label="Message"
              />
              <button type="submit" className="icon-btn send-btn" disabled={!draft.trim() || !canInteract} aria-label="Send">
                <SendIcon />
              </button>
            </form>
            <MicButton
              recording={recording === "talk"}
              disabled={!micSupported || busy !== null || (recording !== null && recording !== "talk")}
              recorder={recorder}
              onClick={() => toggleRecording("talk")}
              label={recording === "talk" ? "Stop and send" : "Talk to Lǎoshī"}
            />
          </div>
        )}
        {!micSupported && hasConversation && (
          <p className="fine-print">Voice input isn&apos;t available in this browser. You can still type.</p>
        )}
      </footer>
    </div>
  );
}
