// PROTOTYPE: in-memory timeline state shared by all variants (the real app would use Zustand).
import { useEffect, useMemo, useState } from "react";
import type { Tables } from "./tables";

export type YMode = "standing" | "cum";

export function useTimeline(t: Tables) {
  const [x, setX] = useState(10);
  const [yMode, setYMode] = useState<YMode>("standing");
  const [focus, setFocusRaw] = useState(t.D - 1);
  const [view, setView] = useState<[number, number]>([0, t.D - 1]);
  const [pinned, setPinned] = useState<number[]>([]);
  const [hover, setHover] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(15); // Days per second

  const setFocus = (d: number) => setFocusRaw(Math.max(0, Math.min(t.D - 1, d)));

  // autoplay: advance the Focus Day, keep it inside the window by paging the view
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setFocusRaw((f) => {
        if (f >= t.D - 1) { setPlaying(false); return f; }
        const n = f + 1;
        setView(([a, b]) => {
          const span = b - a;
          if (n > a + span * 0.85 || n < a) {
            const na = Math.min(t.D - 1 - span, Math.max(0, n - span * 0.85));
            return [na, na + span];
          }
          return [a, b];
        });
        return n;
      });
    }, 1000 / speed);
    return () => clearInterval(id);
  }, [playing, speed]);

  const startPlay = () => {
    if (focus >= t.D - 1) { setFocusRaw(Math.round(view[0])); }
    setPlaying(true);
  };

  return {
    t, x, setX, yMode, setYMode, focus, setFocus, view, setView, pinned, hover, setHover, playing, setPlaying, startPlay, speed, setSpeed,
    pin: (a: number) => setPinned((p) => (p.includes(a) ? p : [...p, a])),
    unpin: (a: number) => setPinned((p) => p.filter((q) => q !== a)),
    togglePin: (a: number) => setPinned((p) => (p.includes(a) ? p.filter((q) => q !== a) : [...p, a])),
  };
}
export type Timeline = ReturnType<typeof useTimeline>;

// lines drawn: every Artist in the Top X on any visible Day, plus Pinned Artists
export function drawnSet(t: Tables, tl: Pick<Timeline, "view" | "x" | "pinned">): Set<number> {
  const s = new Set<number>(tl.pinned);
  const d0 = Math.max(0, Math.floor(tl.view[0])), d1 = Math.min(t.D - 1, Math.ceil(tl.view[1]));
  for (let d = d0; d <= d1; d++) {
    const n = Math.min(tl.x, t.ranked[d]);
    for (let i = 0; i < n; i++) s.add(t.order[d * t.A + i]);
  }
  return s;
}

export function useDrawnCount(tl: Timeline) {
  return useMemo(() => drawnSet(tl.t, tl).size, [tl.view[0], tl.view[1], tl.x, tl.pinned]);
}

const PAL = ["#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f", "#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#5fa2ce", "#d37295", "#8cd17d", "#b6992d", "#499894", "#86bcb6", "#e19d9a"];
export const colorOf = (a: number) => PAL[(a * 7919) % PAL.length];

export const fmtDay = (iso: string) =>
  new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
