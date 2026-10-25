// PROTOTYPE: floating variant switcher (dev builds only).
import { useEffect } from "react";

type V = { key: string; name: string };

export function PrototypeSwitcher({ variants, current, go }: { variants: V[]; current: string; go: (k: string) => void }) {
  const i = variants.findIndex((v) => v.key === current);
  const step = (d: number) => go(variants[(i + d + variants.length) % variants.length].key);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  });
  return (
    <div className="proto-switch">
      <button onClick={() => step(-1)}>←</button>
      <span>{current} ({variants[i].name})</span>
      <button onClick={() => step(1)}>→</button>
    </div>
  );
}
