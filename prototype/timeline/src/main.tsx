// PROTOTYPE entry: load the local history, build tables, mount the chosen ?variant=.
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { build, type Tables } from "./tables";
import { useTimeline } from "./state";
import { VariantA, VariantB, VariantC } from "./variants";
import { PrototypeSwitcher } from "./PrototypeSwitcher";
import "./style.css";

const VARIANTS = [
  { key: "A", name: "Dashboard", C: VariantA },
  { key: "B", name: "Player", C: VariantB },
  { key: "C", name: "Leaderboard", C: VariantC },
];

function useVariant() {
  const [v, setV] = useState(() => new URLSearchParams(location.search).get("variant") ?? "A");
  const go = (k: string) => {
    const u = new URL(location.href);
    u.searchParams.set("variant", k);
    history.replaceState(null, "", u);
    setV(k);
  };
  return [v, go] as const;
}

function Page({ t }: { t: Tables }) {
  const tl = useTimeline(t);
  const [v, go] = useVariant();
  const cur = VARIANTS.find((x) => x.key === v) ?? VARIANTS[0];
  return (
    <>
      <cur.C tl={tl} />
      {import.meta.env.DEV && <PrototypeSwitcher variants={VARIANTS} current={cur.key} go={go} />}
    </>
  );
}

function App() {
  const [t, setT] = useState<Tables | null>(null);
  const [ms, setMs] = useState(0);
  useEffect(() => {
    fetch("/data.json").then((r) => r.json()).then((raw) => {
      const t0 = performance.now();
      const t = build(raw);
      setMs(Math.round(performance.now() - t0));
      setT(t);
    });
  }, []);
  if (!t) return <p style={{ padding: 20 }}>Building Standings…</p>;
  console.log(`tables built in ${ms} ms`);
  return <Page t={t} />;
}

createRoot(document.getElementById("root")!).render(<App />);
