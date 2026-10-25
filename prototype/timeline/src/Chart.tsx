// PROTOTYPE: D3-on-Canvas timeline. d3-zoom drives horizontal pan/zoom; everything is redrawn per frame.
import { useEffect, useRef } from "react";
import { scaleLinear, scaleLog, scaleUtc } from "d3-scale";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";
import { type Timeline, colorOf, drawnSet } from "./state";

export type Below = "clip" | "gutter" | "log";
type Props = { tl: Timeline; height?: number | string; labels: "right" | "focus" | "none"; below: Below; dark?: boolean };

const M = { l: 44, r: 150, t: 22, b: 26 };

export function Chart({ tl, height = 480, labels, below, dark }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const zb = useRef<ZoomBehavior<HTMLCanvasElement, unknown>>(null);
  const size = useRef({ w: 800, h: 400 });
  const syncing = useRef(false);
  const tlRef = useRef(tl);
  tlRef.current = tl;
  const t = tl.t;
  const right = labels === "right" ? M.r : 16;

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
      let max = 1;
      for (let d = Math.floor(view[0]); d <= Math.ceil(view[1]); d++) for (const a of drawn) max = Math.max(max, t.cum[d * t.A + a]);
      const ys = scaleLinear().domain([0, max]).nice().range([bot, top]);
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

    // lines
    g.save(); g.beginPath(); g.rect(M.l, top - 6, w - right - M.l, bot - top + 12); g.clip();
    const d0 = Math.max(0, Math.floor(view[0])), d1 = Math.min(t.D - 1, Math.ceil(view[1]));
    const step = Math.max(1, Math.floor((d1 - d0) / (w - right - M.l)));
    const ordered = [...drawn].sort((a, b) => (a === hover ? 1 : b === hover ? -1 : 0));
    for (const a of ordered) {
      const isP = pinned.includes(a);
      g.strokeStyle = colorOf(a);
      g.globalAlpha = hover == null || hover === a ? 1 : 0.18;
      g.lineWidth = a === hover ? 3 : isP ? 2.5 : 1.6;
      g.setLineDash(isP && yMode === "standing" && t.standing[focus * t.A + a] > X ? [4, 3] : []);
      g.beginPath();
      let pen = false;
      for (let d = d0; d <= d1; d += step) {
        const yy = y(a, d);
        if (yy == null) { pen = false; continue; }
        pen ? g.lineTo(xs(d), yy) : g.moveTo(xs(d), yy);
        pen = true;
      }
      g.stroke();
    }
    g.setLineDash([]); g.globalAlpha = 1; g.restore();

    // focus marker
    const fx = xs(focus);
    if (fx >= M.l && fx <= w - right) {
      g.strokeStyle = fg; g.lineWidth = 1; g.beginPath(); g.moveTo(fx, top - 8); g.lineTo(fx, bot); g.stroke();
      g.fillStyle = fg; g.font = "bold 11px system-ui"; g.fillText(t.days[focus], Math.min(fx - 30, w - right - 64), 12);
      for (const a of drawn) {
        const yy = y(a, focus);
        if (yy == null || yy > bot + 1) continue;
        g.fillStyle = colorOf(a); g.beginPath(); g.arc(fx, yy, a === hover ? 5 : 3, 0, 7); g.fill();
        if (labels === "focus" && (yMode === "cum" || t.standing[focus * t.A + a] <= X || pinned.includes(a))) {
          g.font = "11px system-ui"; g.fillStyle = fg; g.fillText(t.artists[a], fx + 7, yy + 4);
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

