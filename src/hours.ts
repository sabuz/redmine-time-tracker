/**
 * Many companies only accept time in fixed steps (quarter hours, say). Redmine can't tell an app
 * about such a policy, so it is a setting: `increment` is the step in hours, or 0 for none.
 * Quarter hours are the default.
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
 * Redmine can't say whether it wants fixed steps, but it does refuse values it dislikes. When it
 * refuses an off-step time and no step is set, point at the setting.
 */
export function stepHint(message: string, hours: number, increment: number): string {
  const offQuarter = Math.abs(hours * 4 - Math.round(hours * 4)) > 1e-9;
  if (increment === 0 && offQuarter && /hour|time|step|increment|multiple|quarter/i.test(message)) {
    return `${message} If your company only accepts fixed steps such as quarter hours, set Time increments in Settings.`;
  }
  return message;
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
