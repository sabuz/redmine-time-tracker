import { useMemo, useState } from "preact/hooks";
import { buildTimeline, formatSpan, type Session, type Timeline } from "../timeline";

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const dayAndClock = (ms: number) => `${new Date(ms).toLocaleDateString([], { weekday: "short" })} ${clock(ms)}`;

// The chart's own box, in the same pixels it is drawn at (the popover is as wide as the svg).
const W = 244;
const H = 92;
const PAD = { left: 40, right: 12, top: 12, bottom: 22 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;
const px = (x: number) => PAD.left + x * PLOT_W;
const py = (y: number) => PAD.top + (1 - y) * PLOT_H;

/** Time worked so far against the clock: it climbs while the timer ran and stays flat while it didn't. */
function Chart({ tl }: { tl: Timeline }) {
  const label = (ms: number) => (tl.multiDay ? dayAndClock(ms) : clock(ms));
  const line = tl.points.map((p) => `${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`).join(" ");
  const area = `${px(0)},${py(0)} ${line} ${px(1)},${py(0)}`;
  // Each session ends on every second point (the first is the origin; a gap adds a point before each later session).
  const ends = tl.points.filter((_, i) => i > 0 && tl.points[i].y > tl.points[i - 1].y);
  const dots = tl.sessions.length <= 8;
  return (
    <svg class="tip-chart" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`Time worked: ${formatSpan(tl.totalMs)} in ${tl.sessions.length} stretch${tl.sessions.length === 1 ? "" : "es"}`}>
      <line class="grid" x1={PAD.left} x2={W - PAD.right} y1={py(1)} y2={py(1)} />
      <line class="axis" x1={PAD.left} x2={W - PAD.right} y1={py(0)} y2={py(0)} />
      <text class="tick" x={PAD.left - 6} y={py(1) + 3} text-anchor="end">{formatSpan(tl.totalMs)}</text>
      <text class="tick" x={PAD.left - 6} y={py(0) + 3} text-anchor="end">0</text>
      {tl.breaks.map((b) => (
        <line key={b.x1} class="break" x1={px((b.x1 + b.x2) / 2)} x2={px((b.x1 + b.x2) / 2)} y1={py(1)} y2={py(0)} />
      ))}
      <polygon class="area" points={area} />
      <polyline class="series" points={line} />
      {dots && ends.map((p) => <circle key={`${p.x}`} class="dot" cx={px(p.x)} cy={py(p.y)} r={3.5} />)}
      <text class="tick" x={PAD.left} y={H - 5} text-anchor="start">{label(tl.firstStart)}</text>
      <text class="tick" x={W - PAD.right} y={H - 5} text-anchor="end">{label(tl.lastEnd)}</text>
    </svg>
  );
}

/** The text of the same facts, for assistive technology. */
const summary = (tl: Timeline): string =>
  `Timed ${formatSpan(tl.totalMs)}: ${tl.sessions
    .slice(-4)
    .map(([a, b]) => `${clock(a)}–${clock(b)}`)
    .join(", ")}`;

interface Anchor {
  left: number;
  /** Distance from the window's top (opening downwards) or bottom (opening upwards). */
  top?: number;
  bottom?: number;
}

/**
 * The little clock beside an entry that was timed. Hover or focus it for a card with a line chart of the time
 * worked and the stretches it came from. The card is fixed to the window, so the scrolling list can't clip it.
 */
export function TimedTip({ sessions }: { sessions: Session[] }) {
  const [at, setAt] = useState<Anchor | null>(null);
  const tl = useMemo(() => buildTimeline(sessions), [sessions]);
  if (!tl) return null;

  const open = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const width = W + 28; // the card's padding
    const left = Math.max(8, Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - 8));
    // Open towards the side with more room.
    setAt(r.top > window.innerHeight / 2 ? { left, bottom: window.innerHeight - r.top + 8 } : { left, top: r.bottom + 8 });
  };

  const shown = tl.sessions.slice(-4);
  const earlier = tl.sessions.length - shown.length;
  const when = (ms: number) => (tl.multiDay ? dayAndClock(ms) : clock(ms));

  return (
    <span
      class="timed"
      tabIndex={0}
      aria-label={summary(tl)}
      onMouseEnter={(e) => open(e.currentTarget)}
      onMouseLeave={() => setAt(null)}
      onFocus={(e) => open(e.currentTarget)}
      onBlur={() => setAt(null)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && at) {
          e.stopPropagation();
          setAt(null);
        }
      }}
    >
      <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="6" /><path d="M8 4.5V8l2.2 1.4" /></svg>
      {at && (
        <span class="tip" role="tooltip" style={{ left: at.left, top: at.top, bottom: at.bottom }}>
          <span class="tip-head">
            <b>Timed {formatSpan(tl.totalMs)}</b>
            <span class="muted">{tl.sessions.length} stretch{tl.sessions.length === 1 ? "" : "es"}</span>
          </span>
          <Chart tl={tl} />
          <span class="tip-list">
            {earlier > 0 && <span class="muted">+{earlier} earlier</span>}
            {shown.map(([a, b]) => (
              <span class="tip-row" key={a}>
                <span>{when(a)} – {clock(b)}</span>
                <span class="muted">{formatSpan(b - a)}</span>
              </span>
            ))}
          </span>
        </span>
      )}
    </span>
  );
}
