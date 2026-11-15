/**
 * Many companies only accept time in fixed steps (quarter hours, say). Redmine can't tell an app about
 * such a policy, so the app starts with no step (`increment` is 0) and learns the step the first time Redmine
 * refuses an off-step time (see `looksLikeStepRefusal`). A step is in hours; 0 means none.
 * Quarter hours are the step that rule is learned as, and what callers get if they don't say.
 */
export const DEFAULT_INCREMENT = 0.25;
export const MAX_HOURS = 24;

/** Rounds to the nearest step; with no step, to hundredths (Redmine's precision). */
export const snap = (hours: number, increment: number = DEFAULT_INCREMENT): number =>
  increment > 0 ? Math.round(hours / increment) * increment : Math.round(hours * 100) / 100;

/**
 * Rounds up to the next step: any part of a step counts, so no time worked is left out (25 minutes
 * is 30 with 15-minute steps). With no step it is to hundredths, nearest. Timers use this; typed
 * times use `snap`, because what someone types is what they meant.
 */
export const roundUp = (hours: number, increment: number = DEFAULT_INCREMENT): number =>
  increment > 0 ? Math.ceil(hours / increment - 1e-9) * increment : snap(hours, 0);

/** What the − and + buttons move by. */
export const stepOf = (increment: number): number => (increment > 0 ? increment : DEFAULT_INCREMENT);

/** The least a new entry can be. */
export const smallest = (increment: number): number => (increment > 0 ? increment : 0.01);

/**
 * Whether Redmine's refusal of `hours` looks like a fixed-step rule (15-minute steps, say) that the app doesn't
 * know about yet. Only a guess, from the wording and from the time being off the quarter-hour grid; the caller
 * retries on the grid and only believes the guess if that works.
 */
export function looksLikeStepRefusal(message: string, hours: number, increment: number): boolean {
  const offGrid = Math.abs(hours / DEFAULT_INCREMENT - Math.round(hours / DEFAULT_INCREMENT)) > 1e-9;
  return increment === 0 && offGrid && /hour|time|step|increment|multiple|quarter|minute|divis/i.test(message);
}

/**
 * Runs `attempt(hours)`. If Redmine refuses it in a way that looks like a fixed-step rule and no step is set,
 * tries once more with the time rounded up to the step; `onLearned` is called only if that works.
 * If the retry fails too, the first error is what the caller sees.
 */
export async function withStepRetry<T>(
  hours: number,
  increment: number,
  messageOf: (error: unknown) => string,
  attempt: (hours: number) => Promise<T>,
  onLearned: (step: number) => void,
): Promise<T> {
  try {
    return await attempt(hours);
  } catch (e) {
    if (!looksLikeStepRefusal(messageOf(e), hours, increment)) throw e;
    const result = await attempt(roundUp(hours, DEFAULT_INCREMENT)).catch(() => {
      throw e;
    });
    onLearned(DEFAULT_INCREMENT);
    return result;
  }
}

export const clamp = (hours: number): number => Math.min(MAX_HOURS, Math.max(0, hours));

/** "1.75" — always two decimals so columns line up. */
export const fmt = (hours: number): string => hours.toFixed(2);

/**
 * Parse what people actually type: "1.5", "1,5", ".25", "1:30", "1h", "1h30",
 * "1h 30m", "90m". Returns hours rounded to the step (see `snap`), or null if
 * the text isn't a time.
 */
export function parseHours(input: string, increment: number = DEFAULT_INCREMENT): number | null {
  const s = input.trim().toLowerCase().replace(",", ".");
  if (!s) return null;

  let hours: number;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d*\.?\d+|\d+\.)$/))) {
    hours = parseFloat(m[1]);
  } else if ((m = s.match(/^(\d+):(\d{1,2})$/))) {
    hours = Number(m[1]) + Number(m[2]) / 60;
  } else if ((m = s.match(/^(\d+)\s*h\s*(\d{1,2})$/))) {
    hours = Number(m[1]) + Number(m[2]) / 60;
  } else if ((m = s.match(/^(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+(?:\.\d+)?)\s*m(?:in(?:ute)?s?)?)?$/)) && (m[1] || m[2])) {
    hours = Number(m[1] ?? 0) + Number(m[2] ?? 0) / 60;
  } else {
    return null;
  }
  return Number.isFinite(hours) ? snap(hours, increment) : null;
}
