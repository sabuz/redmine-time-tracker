// The shape of the stretches a timer logged to an entry, for the chart in the row tooltip.
// Kept free of UI so it can be tested on its own.

/** A stretch worked, as [start, end] epoch ms. */
export type Session = [number, number];

export interface Timeline {
  /** Cumulative time worked against the clock: x and y are both 0..1. Flat stretches are the gaps between sessions. */
  points: { x: number; y: number }[];
  /** Where the line is a long gap squeezed down, as x ranges (only when the sessions are days apart). */
  breaks: { x1: number; x2: number }[];
  /** Where each session starts, as x (0..1). */
  starts: number[];
  totalMs: number;
  firstStart: number;
  lastEnd: number;
  /** The sessions are not all on one calendar day. */
  multiDay: boolean;
  sessions: Session[];
}

/** Past this span, long gaps are drawn short so a few hours of work isn't a sliver on a days-long axis. */
const COMPRESS_OVER_MS = 14 * 3_600_000;
const GAP_CAP_MS = 3_600_000;

const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();

export function buildTimeline(input: Session[]): Timeline | null {
  const sessions = input.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  if (!sessions.length) return null;

  const firstStart = sessions[0][0];
  const lastEnd = Math.max(...sessions.map(([, b]) => b));
  const compress = lastEnd - firstStart > COMPRESS_OVER_MS;

  let pos = 0; // along the axis, in ms
  let worked = 0;
  const raw: { x: number; y: number }[] = [{ x: 0, y: 0 }];
  const rawBreaks: { x1: number; x2: number }[] = [];
  const rawStarts: number[] = [];
  let prevEnd = firstStart;

  for (const [start, end] of sessions) {
    const gap = Math.max(0, start - prevEnd);
    if (gap > 0) {
      const shown = compress && gap > GAP_CAP_MS ? GAP_CAP_MS : gap;
      if (shown !== gap) rawBreaks.push({ x1: pos, x2: pos + shown });
      pos += shown;
      raw.push({ x: pos, y: worked }); // flat: nothing is counted while nobody works
    }
    rawStarts.push(pos);
    pos += end - start;
    worked += end - start;
    raw.push({ x: pos, y: worked });
    prevEnd = Math.max(prevEnd, end);
  }

  return {
    points: raw.map((p) => ({ x: p.x / pos, y: p.y / worked })),
    breaks: rawBreaks.map((b) => ({ x1: b.x1 / pos, x2: b.x2 / pos })),
    starts: rawStarts.map((x) => x / pos),
    totalMs: worked,
    firstStart,
    lastEnd,
    multiDay: !sameDay(firstStart, lastEnd),
    sessions,
  };
}

/** "1h 20m", "25m", "40s". */
export function formatSpan(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return m ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${total}s`;
}
