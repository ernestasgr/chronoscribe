import { useEffect, useState, type FormEvent } from "react";
import { listenerId, type Db, type ListenerRow } from "../db";
import { importListener, type ImportProgress } from "../ingest";
import { dayDate, topX } from "../standings";
import { rebuild, useTables } from "../timeline";
import { useSettings } from "./settings";

type Screen =
  | { kind: "setup"; error?: string }
  | { kind: "importing"; username: string; progress?: ImportProgress }
  | { kind: "dashboard"; listener: ListenerRow };

export function App({ db, initialListener }: { db: Db; initialListener: ListenerRow | undefined }) {
  const [screen, setScreen] = useState<Screen>(
    initialListener ? { kind: "dashboard", listener: initialListener } : { kind: "setup" },
  );

  const listener = screen.kind === "dashboard" ? screen.listener : undefined;
  useEffect(() => {
    if (listener) void rebuild(listener.id, listener.timeZone);
  }, [listener]);

  async function addListener(username: string, apiKey: string) {
    useSettings.getState().update({ apiKey });
    setScreen({ kind: "importing", username });
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    try {
      await importListener(db, { username, apiKey, timeZone }, undefined, {
        onProgress: (progress) => setScreen({ kind: "importing", username, progress }),
      });
      const imported = await db.listener(listenerId(username));
      setScreen(imported ? { kind: "dashboard", listener: imported } : { kind: "setup" });
    } catch (error) {
      setScreen({ kind: "setup", error: error instanceof Error ? error.message : String(error) });
    }
  }

  switch (screen.kind) {
    case "setup":
      return <Setup error={screen.error} onSubmit={addListener} />;
    case "importing":
      return (
        <main>
          <h1>Importing {screen.username}</h1>
          <p role="status">
            {screen.progress
              ? `${screen.progress.fetched.toLocaleString("en")} / ${screen.progress.total.toLocaleString("en")} Scrobbles`
              : "Starting…"}
          </p>
        </main>
      );
    case "dashboard":
      return <FocusDayPanel username={screen.listener.username} />;
  }
}

function Setup({
  error,
  onSubmit,
}: {
  error?: string;
  onSubmit: (username: string, apiKey: string) => void;
}) {
  const storedKey = useSettings((state) => state.apiKey);
  const [username, setUsername] = useState("");
  const [apiKey, setApiKey] = useState(storedKey);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit(username.trim(), apiKey.trim());
  }

  return (
    <main>
      <h1>Add a Listener</h1>
      <form onSubmit={submit}>
        <label>
          last.fm username{" "}
          <input value={username} onChange={(e) => setUsername(e.target.value)} required />
        </label>
        <label>
          API key <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} required />
        </label>
        <button type="submit">Import</button>
      </form>
      {error && <p role="alert">{error}</p>}
    </main>
  );
}

function FocusDayPanel({ username }: { username: string }) {
  const tables = useTables();
  const x = useSettings((state) => state.x);
  const update = useSettings((state) => state.update);
  const [focusDay, setFocusDay] = useState<number | undefined>(undefined);

  if (!tables) return <p role="status">Building {username}'s Standings…</p>;
  const day = Math.min(focusDay ?? tables.dayCount - 1, tables.dayCount - 1);

  return (
    <main>
      <h1>{username}</h1>
      <label>
        Focus Day{" "}
        <input
          type="range"
          min={0}
          max={tables.dayCount - 1}
          value={day}
          onChange={(e) => setFocusDay(Number(e.target.value))}
        />
      </label>
      <label>
        X{" "}
        <input
          type="number"
          min={1}
          max={100}
          value={x}
          onChange={(e) => {
            const value = Number(e.target.value);
            if (Number.isInteger(value) && value >= 1 && value <= 100) update({ x: value });
          }}
        />
      </label>
      <section aria-label="Focus Day">
        <h2>{dayDate(tables, day)}</h2>
        <ol aria-label="Top X">
          {topX(tables, day, x).map((row) => (
            <li key={row.artist}>
              #{row.standing} {row.artist} · {row.cumulative.toLocaleString("en")}
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
