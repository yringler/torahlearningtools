import { useEffect, useState, type ReactNode } from "react";
import { MasechtaProvider } from "../components/MasechtaGate";
import { isDownloaded, readMasechta } from "../data";
import { loadFailure, masechtaHe } from "../nav";
import type { Masechta } from "../types";
import { useNavigatorOnline } from "../useOnline";

type State = { s: "loading" } | { s: "ready"; text: Masechta } | { s: "failed"; kind: "offline" | "error" };

/**
 * The library's MasechtaGate. It loads the text with readMasechta(), which never changes the active masechta, so a
 * learner's screen kept mounted (hidden) under the library keeps reading its own text. Children get the text itself,
 * and useMasechta() (names, sources) through MasechtaProvider. Same copy and offline behaviour as MasechtaGate.
 */
export function LibraryGate({ id, onChooseOther, children }: {
  id: string; onChooseOther: () => void; children: (text: Masechta) => ReactNode;
}) {
  const [state, setState] = useState<State>({ s: "loading" });
  const [attempt, setAttempt] = useState(0);
  const online = useNavigatorOnline();

  useEffect(() => {
    let cancelled = false;
    setState((st) => (st.s === "ready" ? st : { s: "loading" }));
    readMasechta(id).then(
      (text) => { if (!cancelled) setState({ s: "ready", text }); },
      async () => {
        const downloaded = await isDownloaded(id);
        if (!cancelled) setState({ s: "failed", kind: loadFailure(navigator.onLine, downloaded) });
      },
    );
    return () => { cancelled = true; };
  }, [id, attempt]);

  useEffect(() => {
    if (online && state.s === "failed" && state.kind === "offline") setAttempt((n) => n + 1);
  }, [online]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state.s === "ready") return <MasechtaProvider id={id}>{children(state.text)}</MasechtaProvider>;
  const name = <bdi dir="rtl" lang="he">{masechtaHe(id)}</bdi>;
  return (
    <div className="auth" dir="ltr">
      <div className="auth-card">
        {state.s === "loading" ? <p className="hint">Loading {name}…</p> : state.kind === "offline" ? (
          <>
            <h2>{name} needs the internet once</h2>
            <p>Connect to the internet to open it the first time. After that it's saved on this device and works offline.</p>
          </>
        ) : (
          <>
            <h2>Couldn't load {name}</h2>
            <p>Something went wrong. Check the connection and try again.</p>
          </>
        )}
        {state.s === "failed" && <button className="btn primary big" onClick={() => setAttempt((n) => n + 1)}>Retry</button>}
        {state.s === "failed" && <button className="btn ghost-btn" onClick={onChooseOther}>Choose a different masechta</button>}
      </div>
    </div>
  );
}
