// PROTOTYPE: small pieces the variants compose differently.
import { useEffect, useMemo, useRef, useState } from "react";
import { climbers, dailyPlays, topX, type Climber } from "./tables";
import { colorOf, type Timeline } from "./state";

export function Search({ tl, placeholder = "Search Artist to pin…" }: { tl: Timeline; placeholder?: string }) {
  const { t } = tl;
  const [q, setQ] = useState("");
  const byTotal = useMemo(() => [...t.artists.keys()].sort((a, b) => t.cum[(t.D - 1) * t.A + b] - t.cum[(t.D - 1) * t.A + a]), [t]);
  const hits = q ? byTotal.filter((a) => t.artists[a].toLowerCase().includes(q.toLowerCase())).slice(0, 8) : [];
  return (
    <div className="search">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} onKeyDown={(e) => { if (e.key === "Enter" && hits[0] != null) { tl.pin(hits[0]); setQ(""); } }} />
      {hits.length > 0 && (
        <ul className="hits">
          {hits.map((a) => (
            <li key={a} onMouseDown={() => { tl.pin(a); setQ(""); }}>
              <i style={{ background: colorOf(a) }} /> {t.artists[a]} <small>{t.cum[(t.D - 1) * t.A + a]} Scrobbles</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PinnedChips({ tl }: { tl: Timeline }) {
  const { t, focus } = tl;
  return (
    <div className="chips">
      {tl.pinned.map((a) => (
        <span key={a} className="chip" style={{ borderColor: colorOf(a) }} onMouseEnter={() => tl.setHover(a)} onMouseLeave={() => tl.setHover(null)}>
          📌 {t.artists[a]} <small>{t.standing[focus * t.A + a] ? "#" + t.standing[focus * t.A + a] : "unranked"}</small>
          <button onClick={() => tl.unpin(a)}>×</button>
        </span>
      ))}
    </div>
  );
}

export function XSetting({ tl }: { tl: Timeline }) {
  return (
    <label className="ctl">Top <input type="number" min={3} max={50} value={tl.x} onChange={(e) => tl.setX(Math.max(1, Math.min(100, +e.target.value || 1)))} style={{ width: 46 }} /></label>
  );
}

export function YSwitch({ tl }: { tl: Timeline }) {
  return (
    <div className="seg">
      <button className={tl.yMode === "standing" ? "on" : ""} onClick={() => tl.setYMode("standing")}>Standing</button>
      <button className={tl.yMode === "cum" ? "on" : ""} onClick={() => tl.setYMode("cum")}>Scrobbles</button>
    </div>
  );
}

export function Play({ tl, big }: { tl: Timeline; big?: boolean }) {
  return (
    <span className="ctl">
      <button className={big ? "play big" : "play"} onClick={() => (tl.playing ? tl.setPlaying(false) : tl.startPlay())}>{tl.playing ? "❚❚" : "▶"}</button>
      <select value={tl.secPerDay} onChange={(e) => tl.setSecPerDay(+e.target.value)} title="Seconds per Day">
        {[0.02, 0.05, 0.1, 0.25, 0.5, 1, 2].map((s) => <option key={s} value={s}>{s} s/Day</option>)}
      </select>
    </span>
  );
}

export function TopXList({ tl, bars = true }: { tl: Timeline; bars?: boolean }) {
  const { t, focus } = tl;
  const top = topX(t, focus, tl.x);
  const max = Math.max(1, ...top.map((a) => dailyPlays(t, focus, a)));
  return (
    <table className="topx">
      <tbody>
        {top.map((a, i) => {
          const prev = focus ? t.standing[(focus - 1) * t.A + a] : 0;
          const dp = dailyPlays(t, focus, a);
          const delta = prev ? prev - (i + 1) : null;
          return (
            <tr key={a} className={tl.hover === a ? "hl" : ""} onMouseEnter={() => tl.setHover(a)} onMouseLeave={() => tl.setHover(null)}>
              <td className="r">#{i + 1}</td>
              <td className="delta">{delta == null ? <span className="new">NEW</span> : delta > 0 ? <span className="up">▲{delta}</span> : delta < 0 ? <span className="down">▼{-delta}</span> : ""}</td>
              <td><i style={{ background: colorOf(a) }} /> {t.artists[a]}</td>
              <td className="num">{t.cum[focus * t.A + a]}</td>
              <td className="dp">{bars ? <span className="bar" style={{ width: (dp / max) * 60 }} /> : null}{dp ? `+${dp}` : ""}</td>
              <td><button className="pinbtn" onClick={() => tl.togglePin(a)}>{tl.pinned.includes(a) ? "📌" : "pin"}</button></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// Top X as absolutely positioned rows so Standing changes slide rows to their new place
const ROW = 24;
export function TopXAnimated({ tl }: { tl: Timeline }) {
  const { t, focus } = tl;
  const top = topX(t, focus, tl.x);
  const max = Math.max(1, ...top.map((a) => dailyPlays(t, focus, a)));
  return (
    <div className="topx-anim" style={{ height: top.length * ROW }}>
      {top.map((a, i) => {
        const prev = focus ? t.standing[(focus - 1) * t.A + a] : 0;
        const dp = dailyPlays(t, focus, a);
        const delta = prev ? prev - (i + 1) : null;
        return (
          <div key={a} className={"row" + (tl.hover === a ? " hl" : "")} style={{ transform: `translateY(${i * ROW}px)` }} onMouseEnter={() => tl.setHover(a)} onMouseLeave={() => tl.setHover(null)}>
            <span className="r">#{i + 1}</span>
            <span className="delta">{delta == null ? <span className="new">NEW</span> : delta > 0 ? <span className="up">▲{delta}</span> : delta < 0 ? <span className="down">▼{-delta}</span> : ""}</span>
            <span className="name"><i style={{ background: colorOf(a) }} />{t.artists[a]}</span>
            <span className="num">{t.cum[focus * t.A + a]}</span>
            <span className="dp"><span className="bar" style={{ width: (dp / max) * 50 }} />{dp ? `+${dp}` : ""}</span>
            <button className="pinbtn" onClick={() => tl.togglePin(a)}>{tl.pinned.includes(a) ? "📌" : "pin"}</button>
          </div>
        );
      })}
    </div>
  );
}

// Long-tail tie jumps dominate Climbers over all Artists (see scripts/climbers.ts), so the presentation is the question.
export type ClimberMode = "all" | "collapse" | "scoped";
export const CLIMBER_MODES: { k: ClimberMode; label: string }[] = [
  { k: "all", label: "All (raw)" },
  { k: "collapse", label: "Fold long tail" },
  { k: "scoped", label: "Within Top 50" },
];

export function Climbers({ tl, mode, setMode, limit = 8, compact }: { tl: Timeline; mode: ClimberMode; setMode: (m: ClimberMode) => void; limit?: number; compact?: boolean }) {
  const { t, focus } = tl;
  const all = useMemo(() => climbers(t, focus), [t, focus]);
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [focus, mode]);
  const tailCut = Math.max(50, tl.x * 5);
  const head = mode === "all" ? all : all.filter((c) => c.to <= tailCut);
  const tail = all.filter((c) => c.to > tailCut);
  const row = (c: Climber) => (
    <li key={c.a} className={tl.hover === c.a ? "hl" : ""} onMouseEnter={() => tl.setHover(c.a)} onMouseLeave={() => tl.setHover(null)} onClick={() => tl.togglePin(c.a)} title="click to pin">
      <i style={{ background: colorOf(c.a) }} />
      <b>{t.artists[c.a]}</b>
      <span className="gain">+{c.gain}</span>
      {!compact && <small>#{c.from} → #{c.to} · {c.plays} play{c.plays === 1 ? "" : "s"}</small>}
      {c.debut && <span className="new">debut</span>}
    </li>
  );
  return (
    <div className="climbers">
      <div className="seg small">
        {CLIMBER_MODES.map((m) => <button key={m.k} className={mode === m.k ? "on" : ""} onClick={() => setMode(m.k)}>{m.label}</button>)}
      </div>
      <ul>
        {head.slice(0, limit).map(row)}
        {head.length === 0 && <li className="empty">{all.length ? `No Climbers within Top ${tailCut} on this Day` : "Nobody climbed on this Day"}</li>}
      </ul>
      {mode === "collapse" && tail.length > 0 && (
        <div className="tail">
          <button onClick={() => setOpen(!open)}>
            {open ? "▾" : "▸"} {tail.length} long-tail jump{tail.length === 1 ? "" : "s"} beyond #{tailCut}
            {" "}<small>({tail.filter((c) => c.plays === 1).length} on a single play)</small>
          </button>
          {open && <ul>{tail.slice(0, 20).map(row)}</ul>}
        </div>
      )}
    </div>
  );
}

// daily Scrobble volume over the whole history; drag/click to move the window
export function VolumeStrip({ tl, height = 44, focusMode }: { tl: Timeline; height?: number; focusMode?: boolean }) {
  const { t } = tl;
  const cv = useRef<HTMLCanvasElement>(null);
  const drag = useRef<number | null>(null);
  useEffect(() => {
    const c = cv.current!;
    const w = c.clientWidth, h = height, dpr = devicePixelRatio || 1;
    c.width = w * dpr; c.height = h * dpr;
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    let max = 1;
    for (const v of t.total) max = Math.max(max, v);
    g.fillStyle = "#9aa7b8";
    for (let d = 0; d < t.D; d++) { const bh = (t.total[d] / max) * (h - 4); g.fillRect((d / t.D) * w, h - bh, Math.max(1, w / t.D), bh); }
    const [a, b] = tl.view;
    g.fillStyle = "rgba(78,121,167,.18)"; g.strokeStyle = "#4e79a7";
    g.fillRect((a / t.D) * w, 0, ((b - a) / t.D) * w, h); g.strokeRect((a / t.D) * w, 0.5, ((b - a) / t.D) * w, h - 1);
    g.fillStyle = "#e15759"; g.fillRect((tl.ph / t.D) * w - 1, 0, 2, h);
  });
  const toDay = (e: React.MouseEvent) => { const r = cv.current!.getBoundingClientRect(); return ((e.clientX - r.left) / r.width) * t.D; };
  const move = (e: React.MouseEvent) => {
    const d = toDay(e);
    if (focusMode) { tl.setFocus(Math.round(d)); const [a, b] = tl.view; if (d < a || d > b) { const s = b - a; const na = Math.max(0, Math.min(t.D - 1 - s, d - s / 2)); tl.setView([na, na + s]); } return; }
    const [a, b] = tl.view, s = b - a;
    const na = Math.max(0, Math.min(t.D - 1 - s, d - s / 2));
    tl.setView([na, na + s]);
  };
  return (
    <canvas ref={cv} className="strip" style={{ width: "100%", height, cursor: "pointer", display: "block" }}
      onMouseDown={(e) => { drag.current = 1; move(e); }} onMouseMove={(e) => drag.current && move(e)} onMouseUp={() => (drag.current = null)} onMouseLeave={() => (drag.current = null)} />
  );
}

export function StepControl({ tl }: { tl: Timeline }) {
  return (
    <span className="ctl step">
      <button onClick={() => tl.stepBy(-tl.stepSize)} title="Back (,)">◀</button>
      <input type="number" min={1} max={365} value={tl.stepSize} onChange={(e) => tl.setStepSize(Math.max(1, Math.min(365, +e.target.value || 1)))} style={{ width: 52 }} />
      <span>Day{tl.stepSize === 1 ? "" : "s"}</span>
      <button onClick={() => tl.stepBy(tl.stepSize)} title="Forward (.)">▶</button>
      <span className="presets">{[1, 7, 30, 365].map((n) => <button key={n} className={tl.stepSize === n ? "on" : ""} onClick={() => tl.setStepSize(n)}>{n === 365 ? "1y" : n === 30 ? "30d" : n === 7 ? "1w" : "1d"}</button>)}</span>
    </span>
  );
}

export function StepDay({ tl }: { tl: Timeline }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "SELECT")) return;
      if (e.key === "," || e.key === "j") tl.stepBy(-tl.stepSize);
      if (e.key === "." || e.key === "k") tl.stepBy(tl.stepSize);
      if (e.key === " ") { e.preventDefault(); tl.playing ? tl.setPlaying(false) : tl.startPlay(); }
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  });
  return null;
}
