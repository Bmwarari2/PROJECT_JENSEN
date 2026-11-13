"use client";

import { useEffect, useRef } from "react";
import { MicIcon, StopIcon } from "@/components/Icons";
import type { Recorder } from "@/lib/client/recorder";

/** Big round tap-to-talk button with a live input-level ring. */
export function MicButton({
  recording,
  disabled,
  recorder,
  onClick,
  label,
  size = "lg",
}: {
  recording: boolean;
  disabled?: boolean;
  recorder: Recorder | null;
  onClick: () => void;
  label: string;
  size?: "lg" | "md";
}) {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!recording || !recorder) return;
    let frame = 0;
    const tick = () => {
      ref.current?.style.setProperty("--level", recorder.level().toFixed(3));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const el = ref.current;
    return () => {
      cancelAnimationFrame(frame);
      el?.style.setProperty("--level", "0");
    };
  }, [recording, recorder]);

  return (
    <button
      ref={ref}
      type="button"
      className={`mic mic-${size}${recording ? " is-recording" : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={recording}
    >
      {recording ? <StopIcon size={size === "lg" ? 26 : 20} /> : <MicIcon size={size === "lg" ? 28 : 22} />}
    </button>
  );
}
