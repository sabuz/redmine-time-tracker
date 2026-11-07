import { useEffect, useRef, useState } from "preact/hooks";
import { MAX_HOURS, clamp, fmt, parseHours, snap, stepOf } from "../hours";

interface Props {
  value: number;
  /** Called with a valid, quarter-snapped value (> 0) when editing finishes. */
  onCommit: (hours: number) => void;
  /** Called on every keystroke with the parsed value, or null if unparseable. */
  onLive?: (hours: number | null) => void;
  /** The step time is logged in, in hours; 0 for none (see hours.ts). */
  increment: number;
  class?: string;
  label?: string;
}

/** A text field for hours: accepts "1.5", "1:30", "90m"…, rounds to the step, and
 *  steps with ↑/↓. Enter commits, Esc reverts. */
export function HoursInput({ value, onCommit, onLive, increment, class: cls, label }: Props) {
  const [text, setText] = useState(fmt(value));
  const focused = useRef(false);
  const cancelled = useRef(false);

  // Follow outside changes (server refresh, +/- buttons) unless mid-edit.
  useEffect(() => {
    if (!focused.current) setText(fmt(value));
  }, [value]);

  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false;
      setText(fmt(value));
      return;
    }
    const parsed = parseHours(text, increment);
    if (parsed == null || parsed <= 0 || parsed > MAX_HOURS) {
      setText(fmt(value));
      return;
    }
    setText(fmt(parsed));
    if (parsed !== value) onCommit(parsed);
  };

  const step = (dir: 1 | -1) => {
    const next = snap(clamp((parseHours(text, increment) ?? value) + dir * stepOf(increment)), increment);
    setText(fmt(next));
    onLive?.(next);
  };

  return (
    <input
      class={`hours ${cls ?? ""}`}
      inputMode="decimal"
      aria-label={label ?? "Hours"}
      value={text}
      onClick={(e) => e.stopPropagation()}
      onFocus={(e) => {
        focused.current = true;
        e.currentTarget.select();
      }}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onInput={(e) => {
        setText(e.currentTarget.value);
        onLive?.(parseHours(e.currentTarget.value, increment));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          cancelled.current = true;
          e.currentTarget.blur();
        } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          step(e.key === "ArrowUp" ? 1 : -1);
        }
      }}
    />
  );
}
