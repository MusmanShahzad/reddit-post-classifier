"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";

const NUMBER_MS = 450;

function prefersStillness(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** Glides from the shown number to the new one. A first render does not animate. */
export function useAnimatedNumber(value: number): number {
  const [shown, setShown] = useState(value);
  const current = useRef(value);

  useEffect(() => {
    const from = current.current;
    if (from === value) return;
    const show = (next: number) => {
      current.current = next;
      setShown(next);
    };
    if (prefersStillness()) {
      show(value);
      return;
    }

    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const progress = Math.min((now - start) / NUMBER_MS, 1);
      show(progress === 1 ? value : from + (value - from) * (1 - (1 - progress) ** 3));
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return shown;
}

/** A count that changes smoothly, without its surroundings redrawing. */
export function AnimatedNumber({ value, suffix = "" }: { value: number; suffix?: string }) {
  const shown = useAnimatedNumber(value);
  return <span className="tabular-nums">{`${Math.round(shown)}${suffix}`}</span>;
}

/** A bar that moves with its number. */
export function AnimatedProgress({ value, ...props }: ComponentProps<"progress"> & { value: number }) {
  return <progress {...props} value={useAnimatedNumber(value)} />;
}

/** Text that fades in when it changes. It stays still on first render and between changes. */
export function AnimatedText({ text, className = "" }: { text: string; className?: string }) {
  const first = useRef(text);
  const changed = useRef(false);
  if (text !== first.current) changed.current = true;
  return (
    <span key={text} className={`${changed.current ? "animate-text-change" : ""} ${className}`.trim()}>
      {text}
    </span>
  );
}
