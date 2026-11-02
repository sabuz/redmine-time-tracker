/** Time is logged in quarter-hour steps. */
export const STEP = 0.25;
export const MAX_HOURS = 24;

export const snap = (hours: number): number => Math.round(hours / STEP) * STEP;

export const clamp = (hours: number): number => Math.min(MAX_HOURS, Math.max(0, hours));

/** "1.75" — always two decimals so columns line up. */
export const fmt = (hours: number): string => hours.toFixed(2);

/**
 * Parse what people actually type: "1.5", "1,5", ".25", "1:30", "1h", "1h30",
 * "1h 30m", "90m". Returns hours snapped to the nearest quarter, or null if
 * the text isn't a time.
 */
export function parseHours(input: string): number | null {
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
  return Number.isFinite(hours) ? snap(hours) : null;
}
