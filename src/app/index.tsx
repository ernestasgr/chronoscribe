import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { openDb } from "../db";
import { App } from "./App";
import { hydrateSettings } from "./settings";

/** Opens storage, hydrates the stores and renders the app into `root`. */
export async function boot(root: HTMLElement): Promise<void> {
  const db = openDb();
  await hydrateSettings(db);
  const listeners = await db.listeners();
  const current = listeners
    .filter((listener) => listener.importComplete)
    .toSorted((a, b) => b.lastViewedAt - a.lastViewedAt)[0];
  createRoot(root).render(
    <StrictMode>
      <App db={db} initialListener={current} />
    </StrictMode>,
  );
}
