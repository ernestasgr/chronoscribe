import { useEffect, useState, type FormEvent } from "react";
import { listenerId, type Db, type ListenerRow } from "../db";
import { importListener, type ImportProgress } from "../ingest";
import { showListener } from "../timeline";
import { FocusDayPanel } from "./FocusDayPanel";
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
    if (listener) showListener(listener);
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
