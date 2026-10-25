// PROTOTYPE: three structurally different takes on the timeline page.
//  A Dashboard   — toolbar + chart + Focus Day sidebar; minimap pans the window.  Below-the-Top-X: lines slide off (clip).
//  B Player      — full-bleed dark chart, video-player transport, floating Focus Day card.  Below-the-Top-X: compressed gutter.
//  C Leaderboard — Focus Day leaderboard is primary, chart is context with direct labels.  Below-the-Top-X: log axis.
import { useState } from "react";
import { CURVES, Chart, type Below, type Curve } from "./Chart";
import { fmtDay, useDrawnCount, type Timeline } from "./state";
import { Climbers, PinnedChips, Play, Search, StepControl, StepDay, TopXAnimated, TopXList, VolumeStrip, XSetting, YSwitch, type ClimberMode } from "./widgets";

function BelowSelect({ v, set }: { v: Below; set: (b: Below) => void }) {
  return (
    <label className="ctl" title="How Artists outside the Top X (e.g. Pinned Artists) are drawn in Standing mode">
      below Top X:
      <select value={v} onChange={(e) => set(e.target.value as Below)}>
        <option value="clip">slide off</option>
        <option value="gutter">gutter</option>
        <option value="log">log axis</option>
      </select>
    </label>
  );
}

export function VariantA({ tl }: { tl: Timeline }) {
  const [below, setBelow] = useState<Below>("clip");
  const [cm, setCm] = useState<ClimberMode>("collapse");
  const [curve, setCurve] = useState<Curve>("bump");
  const [ghost, setGhost] = useState(true);
  const n = useDrawnCount(tl);
  return (
    <div className="va">
      <StepDay tl={tl} />
      <header>
        <h1>Chronoscribe</h1>
        <Search tl={tl} />
        <XSetting tl={tl} />
        <YSwitch tl={tl} />
        <BelowSelect v={below} set={setBelow} />
        <label className="ctl">lines:
          <select value={curve} onChange={(e) => setCurve(e.target.value as Curve)}>
            {Object.entries(CURVES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </label>
        <label className="ctl"><input type="checkbox" checked={ghost} onChange={(e) => setGhost(e.target.checked)} /> ghost future</label>
        <StepControl tl={tl} />
        <Play tl={tl} />
        <span className="muted">{n} lines</span>
      </header>
      <PinnedChips tl={tl} />
      <div className="va-body">
        <main>
          <Chart tl={tl} labels="focus" below={below} curve={curve} ghost={ghost} height="calc(100vh - 230px)" />
          <VolumeStrip tl={tl} />
          <p className="muted">Scroll to zoom · drag to pan · click to set the Focus Day · , / . step by the step size · space plays</p>
        </main>
        <aside>
          <h2>{fmtDay(tl.t.days[tl.focus])}</h2>
          <p className="muted">{tl.t.total[tl.focus]} Scrobbles this Day</p>
          <h3>Top {tl.x}</h3>
          <TopXAnimated tl={tl} />
          <h3>Climbers</h3>
          <Climbers tl={tl} mode={cm} setMode={setCm} />
        </aside>
      </div>
    </div>
  );
}

export function VariantB({ tl }: { tl: Timeline }) {
  const [below, setBelow] = useState<Below>("gutter");
  const [cm, setCm] = useState<ClimberMode>("scoped");
  const [gear, setGear] = useState(false);
  const [card, setCard] = useState(true);
  return (
    <div className="vb">
      <StepDay tl={tl} />
      <div className="vb-top">
        <span className="brand">Chronoscribe</span>
        <div className="vb-climb"><span className="muted">Climbers</span><Climbers tl={tl} mode={cm} setMode={setCm} limit={4} compact /></div>
        <button onClick={() => setGear(!gear)}>⚙</button>
      </div>
      {gear && (
        <div className="vb-gear">
          <XSetting tl={tl} />
          <YSwitch tl={tl} />
          <BelowSelect v={below} set={setBelow} />
          <Search tl={tl} />
          <PinnedChips tl={tl} />
        </div>
      )}
      <Chart tl={tl} labels="focus" below={below} dark height="calc(100vh - 150px)" />
      {card && (
        <div className="vb-card">
          <button className="x" onClick={() => setCard(false)}>×</button>
          <b>Top {tl.x}</b> <span className="muted">· {tl.t.total[tl.focus]} Scrobbles</span>
          <TopXList tl={tl} bars={false} />
        </div>
      )}
      <div className="vb-transport">
        <Play tl={tl} big />
        <div className="vb-date">{fmtDay(tl.t.days[tl.focus])}</div>
        <div style={{ flex: 1 }}><VolumeStrip tl={tl} height={36} focusMode /></div>
        {!card && <button onClick={() => setCard(true)}>Top {tl.x}</button>}
      </div>
    </div>
  );
}

export function VariantC({ tl }: { tl: Timeline }) {
  const [below, setBelow] = useState<Below>("log");
  const [cm, setCm] = useState<ClimberMode>("collapse");
  return (
    <div className="vc">
      <StepDay tl={tl} />
      <section className="vc-board">
        <div className="vc-date">
          <button onClick={() => tl.setFocus(tl.focus - 1)}>◀</button>
          <div>
            <h1>{fmtDay(tl.t.days[tl.focus])}</h1>
            <span className="muted">Day {tl.focus + 1} of {tl.t.D} · {tl.t.total[tl.focus]} Scrobbles</span>
          </div>
          <button onClick={() => tl.setFocus(tl.focus + 1)}>▶</button>
        </div>
        <div className="row"><Play tl={tl} /><XSetting tl={tl} /></div>
        <TopXList tl={tl} />
        <h3>Climbers</h3>
        <Climbers tl={tl} mode={cm} setMode={setCm} limit={6} />
        <h3>Pinned</h3>
        <Search tl={tl} placeholder="Find an Artist…" />
        <PinnedChips tl={tl} />
      </section>
      <section className="vc-chart">
        <div className="row"><YSwitch tl={tl} /><BelowSelect v={below} set={setBelow} /></div>
        <Chart tl={tl} labels="right" below={below} height="calc(100vh - 110px)" />
        <VolumeStrip tl={tl} height={28} />
      </section>
    </div>
  );
}
