// PROTOTYPE: in-memory timeline state shared by all variants (the real app would use Zustand).
import { useEffect, useMemo, useRef, useState } from "react";
import type { Tables } from "./tables";

export const ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2); // easeInOutCubic

export type YMode = "standing" | "cum";

export function useTimeline(t: Tables) {
  const [x, setX] = useState(10);
  const [yMode, setYMode] = useState<YMode>("standing");
  // ph = playhead, a fractional Day index; the Focus Day is the Day it is nearest to
  const [ph, setPh] = useState(t.D - 1);
  const [view, setViewRaw] = useState<[number, number]>([0, t.D - 1]);
  const [pinned, setPinned] = useState<number[]>([]);
  const [hover, setHover] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [secPerDay, setSecPerDay] = useState(0.1);
  const [stepSize, setStepSize] = useState(1); // Days per manual step
  const focus = Math.max(0, Math.min(t.D - 1, Math.round(ph)));

  // the animation loop reads/writes refs; React state mirrors them once per frame
  const r = useRef({ ph, view, playing, secPerDay, tween: null as null | { p0: number; p1: number; v0: [number, number]; v1: [number, number]; t0: number; dur: number } });
  r.current.playing = playing;
  r.current.secPerDay = secPerDay;
  const setView = (v: [number, number]) => { r.current.view = v; r.current.tween = null; setViewRaw(v); };
  const clampView = (a: number, span: number): [number, number] => { const na = Math.max(0, Math.min(t.D - 1 - span, a)); return [na, na + span]; };

  useEffect(() => {
    let raf = 0, last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(100, now - last) / 1000;
      last = now;
      const s = r.current;
      if (s.playing) {
        s.tween = null;
        s.ph = Math.min(t.D - 1, s.ph + dt / s.secPerDay);
        const span = s.view[1] - s.view[0];
        s.view = clampView(s.ph - span * 0.8, span); // glide: keep the playhead at 80% of the window
        setPh(s.ph); setViewRaw(s.view);
        if (s.ph >= t.D - 1) setPlaying(false);
      } else if (s.tween) {
        const w = s.tween, k = Math.min(1, (now - w.t0) / w.dur), e = ease(k);
        s.ph = w.p0 + (w.p1 - w.p0) * e;
        s.view = [w.v0[0] + (w.v1[0] - w.v0[0]) * e, w.v0[1] + (w.v1[1] - w.v0[1]) * e];
        setPh(s.ph); setViewRaw(s.view);
        if (k >= 1) s.tween = null;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [t]);

  // glide the playhead to Day d, panning the window only if d is outside it
  const glideTo = (d: number) => {
    const s = r.current;
    const p1 = Math.max(0, Math.min(t.D - 1, d));
    const [a, b] = s.view, span = b - a;
    const v1: [number, number] = p1 >= a && p1 <= b ? [a, b] : clampView(p1 > b ? p1 - span * 0.8 : p1 - span * 0.2, span);
    const dist = Math.abs(p1 - s.ph);
    s.tween = { p0: s.ph, p1, v0: [a, b], v1, t0: performance.now(), dur: Math.min(900, 280 + 60 * Math.sqrt(dist)) };
  };
  const setFocus = (d: number) => { setPlaying(false); glideTo(d); };
  const stepBy = (n: number) => { setPlaying(false); glideTo(Math.round(r.current.tween?.p1 ?? r.current.ph) + n); };

  const startPlay = () => {
    const s = r.current;
    if (s.ph >= t.D - 1) s.ph = Math.round(s.view[0]);
    s.ph = Math.round(s.ph);
    setPlaying(true);
  };

  return {
    t, x, setX, yMode, setYMode, ph, focus, setFocus, view, setView, pinned, hover, setHover, playing, setPlaying, startPlay, secPerDay, setSecPerDay, stepSize, setStepSize, stepBy,
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
