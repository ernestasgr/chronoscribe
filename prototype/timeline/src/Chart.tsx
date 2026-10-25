// PROTOTYPE: D3-on-Canvas timeline. d3-zoom drives horizontal pan/zoom; everything is redrawn per frame.
import { useEffect, useRef } from "react";
import { scaleLinear, scaleLog, scaleUtc } from "d3-scale";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";
import { curveBasis, curveBumpX, curveCatmullRom, curveLinear, curveMonotoneX, line, type CurveFactory } from "d3-shape";
import { type Timeline, colorOf, drawnSet } from "./state";

export type Below = "clip" | "gutter" | "log";
export const CURVES: Record<string, { label: string; c: CurveFactory }> = {
  linear: { label: "straight", c: curveLinear },
  bump: { label: "bump (S-curves)", c: curveBumpX },
  monotone: { label: "monotone", c: curveMonotoneX },
  catmull: { label: "Catmull-Rom", c: curveCatmullRom.alpha(0.5) },
  basis: { label: "smoothed (basis)", c: curveBasis },
};
export type Curve = keyof typeof CURVES;
type Props = { tl: Timeline; height?: number | string; labels: "right" | "focus" | "none"; below: Below; dark?: boolean; curve?: Curve; ghost?: boolean };

const M = { l: 44, r: 150, t: 22, b: 26 };

export function Chart({ tl, height = 480, labels, below, dark, curve = "linear", ghost = false }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const zb = useRef<ZoomBehavior<HTMLCanvasElement, unknown>>(null);
  const size = useRef({ w: 800, h: 400 });
  const syncing = useRef(false);
  const tlRef = useRef(tl);
  tlRef.current = tl;
  const t = tl.t;
  const right = labels === "right" ? M.r : labels === "focus" ? 130 : 16;
  const yMax = useRef(0); // eased y-domain max in Scrobbles mode

  // size
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => {
      size.current = { w: e.contentRect.width, h: e.contentRect.height };
      draw();
      syncZoom();
    });
    ro.observe(wrap.current!);
    return () => ro.disconnect();
  }, []);

  // zoom behaviour, x only
  useEffect(() => {
    const c = cv.current!;
    const z = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([1, t.D / 10])
      .on("zoom", (ev) => {
        if (syncing.current) return;
        const w = size.current.w - M.l - right;
        const x0 = scaleLinear().domain([0, t.D - 1]).range([0, w]);
        const [a, b] = ev.transform.rescaleX(x0).domain();
        tlRef.current.setView([Math.max(0, a), Math.min(t.D - 1, b)]);
      });
    z.translateExtent([[0, 0], [size.current.w - M.l - right, 1]]).extent([[0, 0], [size.current.w - M.l - right, 1]]);
    zb.current = z;
    select(c).call(z).on("dblclick.zoom", null);
    return () => void select(c).on(".zoom", null);
  }, [right]);

  function syncZoom() {
    const z = zb.current;
    if (!z) return;
    const w = size.current.w - M.l - right;
    z.translateExtent([[0, 0], [w, 1]]).extent([[0, 0], [w, 1]]);
    const [a, b] = tlRef.current.view;
    const k = (t.D - 1) / Math.max(1, b - a);
    const x0 = scaleLinear().domain([0, t.D - 1]).range([0, w]);
    syncing.current = true;
    select(cv.current!).call(z.transform, zoomIdentity.scale(k).translate(-x0(a), 0));
    syncing.current = false;
  }

  useEffect(() => {
    syncZoom();
  }, [tl.view[0], tl.view[1]]);
  useEffect(draw);

  function scales() {
    const { w, h } = size.current;
    const { view, x: X, yMode } = tlRef.current;
    const xs = scaleLinear().domain(view).range([M.l, w - right]);
    const drawn = drawnSet(t, tlRef.current);
    const top = M.t, bot = h - M.b;
    let y: (a: number, d: number) => number | null;
    let yTicks: { v: string; y: number }[] = [];
    if (yMode === "cum") {
      const { ph, playing } = tlRef.current;
      const dEnd = Math.min(Math.ceil(view[1]), ghost ? Math.ceil(ph) + 1 : Infinity);
      let max = 1;
      for (let d = Math.floor(view[0]); d <= dEnd; d++) for (const a of drawn) max = Math.max(max, t.cum[d * t.A + a]);
      max *= 1.06;
      yMax.current = playing && yMax.current ? yMax.current + (max - yMax.current) * 0.08 : max;
      const ys = scaleLinear().domain([0, yMax.current]).range([bot, top]);
      y = (a, d) => ys(t.cum[d * t.A + a]);
      yTicks = ys.ticks(6).map((v) => ({ v: String(v), y: ys(v) }));
    } else if (below === "log") {
      let max = X + 1;
      for (const a of tlRef.current.pinned) for (let d = Math.floor(view[0]); d <= Math.ceil(view[1]); d++) max = Math.max(max, t.standing[d * t.A + a]);
      const ys = scaleLog().domain([1, max + 1]).range([top, bot]);
      y = (a, d) => { const s = t.standing[d * t.A + a]; return s ? ys(s) : null; };
      yTicks = [1, 2, 3, 5, X, 20, 50, 100, 200, 500, 1000].filter((v) => v <= max).map((v) => ({ v: "#" + v, y: ys(v) }));
    } else {
      const band = below === "gutter" ? Math.min(70, (bot - top) * 0.18) : 0;
      const ys = scaleLinear().domain([0.5, X + 0.5]).range([top, bot - band]);
      const maxR = Math.max(...Array.from(t.ranked.subarray(Math.floor(view[0]), Math.ceil(view[1]) + 1)), X + 2);
      const gs = scaleLog().domain([X + 1, maxR + 1]).range([bot - band + 6, bot]);
      y = (a, d) => {
        const s = t.standing[d * t.A + a];
        if (!s) return below === "gutter" ? bot + 4 : null;
        if (s <= X) return ys(s);
        return below === "gutter" ? gs(s) : bot + 30; // clip: slides off the bottom
      };
      yTicks = Array.from({ length: X }, (_, i) => ({ v: "#" + (i + 1), y: ys(i + 1) })).filter((_, i) => X <= 25 || i % 5 === 0 || i === 0);
      if (band) yTicks.push({ v: `#${X + 1}+`, y: bot - band / 2 });
    }
    return { xs, y, drawn, yTicks, top, bot, w, h };
  }

  function draw() {
    const c = cv.current;
    if (!c) return;
    const dpr = devicePixelRatio || 1;
    const { w, h } = size.current;
    c.width = w * dpr; c.height = h * dpr;
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const fg = dark ? "#ddd" : "#222", mute = dark ? "#666" : "#bbb";
    g.clearRect(0, 0, w, h);
    const { xs, y, drawn, yTicks, top, bot } = scales();
    const { view, focus, hover, pinned, yMode, x: X } = tlRef.current;

    // grid + axes
    g.font = "11px system-ui"; g.fillStyle = mute; g.strokeStyle = dark ? "#2a2a2a" : "#eee"; g.lineWidth = 1;
    for (const tk of yTicks) { g.beginPath(); g.moveTo(M.l, tk.y); g.lineTo(w - right, tk.y); g.stroke(); g.fillText(tk.v, 4, tk.y + 4); }
    if (yMode === "standing" && below === "gutter") { g.fillStyle = dark ? "#ffffff08" : "#00000006"; g.fillRect(M.l, bot - Math.min(70, (bot - top) * 0.18), w - right - M.l, Math.min(70, (bot - top) * 0.18)); }
    const tx = scaleUtc().domain([t.dayStart[Math.floor(view[0])], t.dayStart[Math.ceil(view[1])]]).range([xs(Math.floor(view[0])), xs(Math.ceil(view[1]))]);
    const nT = Math.max(2, Math.floor((w - right - M.l) / 90));
    const fmt = tx.tickFormat(nT);
    g.fillStyle = mute;
    for (const d of tx.ticks(nT)) { const px = tx(d); g.fillText(fmt(d), px - 14, h - 8); }

    // lines: one pixel-space geometry per Artist, shared by the stroke and the gliding head
    const d0 = Math.max(0, Math.floor(view[0])), d1 = Math.min(t.D - 1, Math.ceil(view[1]));
    const step = Math.max(1, Math.floor((d1 - d0) / (w - right - M.l)));
    // Scrobbles change nearly every Day, so change points would merge into one giant S: sample Days and use a monotone curve
    const sampled = curve === "linear" || yMode === "cum";
    const seg = line<[number, number]>().curve(curve === "linear" ? curveLinear : yMode === "cum" ? curveMonotoneX : CURVES[curve].c);
    // Curved: keep only change points and give each change a transition at least MINW px wide,
    // since adjacent Days are often < 1px apart and any curve would collapse into a vertical jump.
    const MINW = 14;
    const geometry = (a: number): [number, number][][] => {
      const out: [number, number][][] = [];
      let cur: [number, number][] = [];
      if (sampled) {
        for (let d = d0; d <= d1; d += step) {
          const yy = y(a, d);
          if (yy == null) { if (cur.length) out.push(cur); cur = []; continue; }
          cur.push([xs(d), yy]);
        }
        if (cur.length) out.push(cur);
        return out;
      }
      let prev: number | null = null;
      for (let d = d0; d <= d1; d++) {
        const yy = y(a, d);
        if (yy == null) { if (cur.length) out.push(cur); cur = []; prev = null; continue; }
        if (prev == null) { cur.push([xs(d), yy]); prev = yy; continue; }
        if (Math.abs(yy - prev) > 0.5) {
          const x0 = xs(d - 1), x1 = xs(d), mid = (x0 + x1) / 2, hw = Math.max((x1 - x0) / 2, MINW / 2);
          const last = cur[cur.length - 1];
          if (mid - hw > last[0] + 0.5) cur.push([mid - hw, prev]);
          else if (cur.length > 1) cur.pop(); // overlapping transitions: curve straight on to the next level
          cur.push([mid + hw, yy]);
          prev = yy;
        }
      }
      if (cur.length) { if (prev != null) cur.push([Math.max(cur[cur.length - 1][0], xs(d1)), prev]); out.push(cur); }
      return out;
    };
    // y of a geometry at pixel x: linear between samples, or along the bump curve's bezier
    const yAt = (segs: [number, number][][], px: number): number | null => {
      for (const sg of segs) {
        if (px < sg[0][0] - 0.5 || px > sg[sg.length - 1][0] + 0.5) continue;
        for (let i = 1; i < sg.length; i++) {
          const [ax, ay] = sg[i - 1], [bx, by] = sg[i];
          if (px > bx) continue;
          if (bx === ax) return by;
          if (sampled) return ay + ((by - ay) * (px - ax)) / (bx - ax);
          let lo = 0, hi = 1; // bump: x(u) = ax + (bx-ax)(3u²-2u³)·… solve numerically
          for (let k = 0; k < 18; k++) { const u = (lo + hi) / 2, m = (ax + bx) / 2; const xu = ax * (1 - u) ** 3 + 3 * m * (1 - u) ** 2 * u + 3 * m * (1 - u) * u * u + bx * u ** 3; xu < px ? (lo = u) : (hi = u); }
          const u = (lo + hi) / 2;
          return ay + (by - ay) * (3 * u * u - 2 * u * u * u);
        }
        return sg[sg.length - 1][1];
      }
      return null;
    };

    const { ph } = tlRef.current;
    const px = xs(ph);
    const clipL = M.l, clipR = w - right;
    const split = Math.max(clipL, Math.min(clipR, px));
    const geo = new Map<number, [number, number][][]>();
    for (const a of drawn) geo.set(a, geometry(a));
    const ordered = [...drawn].sort((a, b) => (a === hover ? 1 : b === hover ? -1 : 0));
    const strokeAll = (alphaMul: number, x0: number, x1: number) => {
      if (x1 <= x0) return;
      g.save(); g.beginPath(); g.rect(x0, top - 6, x1 - x0, bot - top + 12); g.clip();
      for (const a of ordered) {
        const isP = pinned.includes(a);
        g.strokeStyle = colorOf(a);
        g.globalAlpha = (hover == null || hover === a ? 1 : 0.18) * alphaMul;
        g.lineWidth = a === hover ? 3 : isP ? 2.5 : 1.8;
        g.setLineDash(isP && yMode === "standing" && t.standing[focus * t.A + a] > X ? [4, 3] : []);
        g.beginPath();
        for (const sg of geo.get(a)!) seg.context(g)(sg);
        g.stroke();
      }
      g.restore();
    };
    if (ghost) { strokeAll(1, clipL, split); strokeAll(0.12, split, clipR); }
    else strokeAll(1, clipL, clipR);
    g.setLineDash([]); g.globalAlpha = 1;

    // playhead: line, date, gliding dots and de-overlapped labels
    if (px >= clipL - 1 && px <= clipR + 1) {
      g.strokeStyle = fg; g.lineWidth = 1; g.beginPath(); g.moveTo(px, top - 8); g.lineTo(px, bot); g.stroke();
      g.fillStyle = fg; g.font = "bold 11px system-ui"; g.fillText(t.days[focus], Math.max(clipL, Math.min(px - 30, clipR - 64)), 12);
      const heads: { a: number; y: number; label: boolean }[] = [];
      for (const a of drawn) {
        const yy = yAt(geo.get(a)!, px);
        if (yy == null || yy > bot + 2 || yy < top - 8) continue;
        const inTop = t.standing[focus * t.A + a] > 0 && t.standing[focus * t.A + a] <= X;
        heads.push({ a, y: yy, label: inTop || pinned.includes(a) });
      }
      for (const hd of heads) { g.fillStyle = colorOf(hd.a); g.beginPath(); g.arc(px, hd.y, hd.a === hover ? 5.5 : 3.5, 0, 7); g.fill(); }
      if (labels === "focus") {
        const ls = heads.filter((hd) => hd.label).sort((p, q) => p.y - q.y);
        let last = -1e9;
        g.font = "600 11px system-ui";
        for (const hd of ls) {
          const ly = Math.max(hd.y, last + 13); last = ly;
          g.fillStyle = dark ? "#141414cc" : "#ffffffcc";
          const tw = g.measureText(t.artists[hd.a]).width;
          g.fillRect(px + 7, ly - 8, tw + 6, 14);
          g.fillStyle = colorOf(hd.a); g.fillText(t.artists[hd.a], px + 10, ly + 3);
        }
      }
    }

    // direct labels at right edge (de-overlapped)
    if (labels === "right") {
      const items = [...drawn].map((a) => ({ a, y: y(a, d1) })).filter((i) => i.y != null && i.y <= bot + 1).sort((p, q) => p.y! - q.y!) as { a: number; y: number }[];
      let last = -1e9;
      g.font = "11px system-ui";
      for (const it of items) {
        const yy = Math.max(it.y, last + 12); last = yy;
        if (yy > bot + 8) break;
        g.fillStyle = colorOf(it.a); g.fillText(t.artists[it.a].slice(0, 22), w - right + 6, yy + 4);
      }
    }
  }

  function pick(ev: React.MouseEvent) {
    const r = cv.current!.getBoundingClientRect();
    const px = ev.clientX - r.left, py = ev.clientY - r.top;
    const { xs, y, drawn } = scales();
    const d = Math.round(xs.invert(px));
    if (d < 0 || d >= t.D) return { d: null, a: null };
    let best: number | null = null, bd = 8;
    for (const a of drawn) { const yy = y(a, d); if (yy != null && Math.abs(yy - py) < bd) { bd = Math.abs(yy - py); best = a; } }
    return { d, a: best };
  }

  return (
    <div ref={wrap} style={{ position: "relative", height, minHeight: 200 }}>
      <canvas
        ref={cv}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", cursor: "crosshair" }}
        onMouseMove={(e) => { const p = pick(e); if (p.a !== tl.hover) tl.setHover(p.a); }}
        onMouseLeave={() => tl.setHover(null)}
        onClick={(e) => { const p = pick(e); if (p.d != null) tl.setFocus(p.d); }}
      />
    </div>
  );
}

