import { useEffect, useState, type ReactNode } from "react";
import { AuthFrame } from "../auth/Login";
import { DEFAULT_MASECHTA_ID, isMasechtaLoaded, loadMasechta } from "../data";

/** Renders its children once the masechta's text is loaded (from the network, or offline from the service worker). */
export function DataGate({ id = DEFAULT_MASECHTA_ID, children }: { id?: string; children: ReactNode }) {
  const [state, setState] = useState<"loading" | "ready" | "error">(() => (isMasechtaLoaded(id) ? "ready" : "loading"));
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (isMasechtaLoaded(id)) { setState("ready"); return; }
    let cancelled = false;
    setState("loading");
    loadMasechta(id).then(
      () => { if (!cancelled) setState("ready"); },
      () => { if (!cancelled) setState("error"); },
    );
    return () => { cancelled = true; };
  }, [id, attempt]);

  if (state === "ready") return <>{children}</>;
  if (state === "loading") return <AuthFrame><p className="hint">Loading…</p></AuthFrame>;
  return (
    <AuthFrame>
      <h2>Couldn't load the mishnayos</h2>
      <p>Connect to the internet once. After that the text is saved on this device and works offline.</p>
      <button className="btn primary big" onClick={() => setAttempt((n) => n + 1)}>Retry</button>
    </AuthFrame>
  );
}
