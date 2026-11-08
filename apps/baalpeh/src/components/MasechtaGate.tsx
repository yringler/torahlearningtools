import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { entryOf, isDownloaded, isMasechtaLoaded, loadMasechta, shapeOf, type MasechtaShape } from "../data";
import { loadFailure, masechtaHe } from "../nav";
import { useNavigatorOnline } from "../useOnline";

/** The masechta the screens inside a MasechtaGate show. Its text is active (MASECHTA, getMishnah, …) while they render. */
export interface ActiveMasechta {
  id: string;
  shape: MasechtaShape;
  /** "פאה" */
  he: string;
  /** "Peah" (Sefaria's name) */
  en: string;
  /** False for a Hebrew-only masechta: no meanings, word glosses, Steinsaltz or summaries. */
  translated: boolean;
}

export function activeMasechtaOf(id: string): ActiveMasechta {
  const e = entryOf(id);
  return { id, shape: shapeOf(id), he: e?.he ?? "", en: e?.en ?? id, translated: e?.translated ?? false };
}

const Ctx = createContext<ActiveMasechta | null>(null);

/** The masechta of the current screen. Only screens inside a MasechtaGate (or a MasechtaProvider in tests) use it. */
export function useMasechta(): ActiveMasechta {
  const m = useContext(Ctx);
  if (!m) throw new Error("useMasechta outside a MasechtaGate");
  return m;
}

export function MasechtaProvider({ id, children }: { id: string; children: ReactNode }) {
  return <Ctx.Provider value={activeMasechtaOf(id)}>{children}</Ctx.Provider>;
}

/** The sign-in screens' frame, without their links (guest mode must not load the auth screens' modules). */
function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="auth" dir="ltr">
      <h1 className="app-title"><span dir="rtl">משנה בעל פה</span></h1>
      <div className="auth-card">{children}</div>
    </div>
  );
}

type State = { s: "loading" } | { s: "ready" } | { s: "failed"; kind: "offline" | "error" };

/**
 * Renders its children once the masechta's text is loaded and active (from memory, the network, or offline from the
 * service worker). Callers key it by the masechta, so its screens remount when the masechta changes. Only the masechta screens (perek map,
 * mishnah, perek, session) are inside one: the picker and parent mode need no text.
 */
export function MasechtaGate({ id, onChooseOther, children }: { id: string; onChooseOther?: (() => void) | undefined; children: ReactNode }) {
  const [state, setState] = useState<State>(() => (isMasechtaLoaded(id) ? { s: "ready" } : { s: "loading" }));
  const [attempt, setAttempt] = useState(0);
  const online = useNavigatorOnline();

  useEffect(() => {
    if (isMasechtaLoaded(id)) { setState({ s: "ready" }); return; }
    let cancelled = false;
    setState({ s: "loading" });
    loadMasechta(id).then(
      // A newer load for another masechta may have won (loadMasechta: the latest call wins); try again, which is
      // instant from memory, instead of waiting for a load that will never activate this one.
      () => { if (!cancelled) { if (isMasechtaLoaded(id)) setState({ s: "ready" }); else setAttempt((n) => n + 1); } },
      async () => {
        const downloaded = await isDownloaded(id);
        if (!cancelled) setState({ s: "failed", kind: loadFailure(navigator.onLine, downloaded) });
      },
    );
    return () => { cancelled = true; };
  }, [id, attempt]);

  // Back online after "needs internet": try again by itself.
  useEffect(() => {
    if (online && state.s === "failed" && state.kind === "offline") setAttempt((n) => n + 1);
  }, [online]); // eslint-disable-line react-hooks/exhaustive-deps

  // Another gate can make a different masechta active while this one is mounted: never render on the wrong text, and
  // make this one active again (from memory, so at once).
  const stale = state.s === "ready" && !isMasechtaLoaded(id);
  useEffect(() => { if (stale) setAttempt((n) => n + 1); }, [stale]);

  if (state.s === "ready" && !stale) return <Ctx.Provider value={activeMasechtaOf(id)}>{children}</Ctx.Provider>;
  const name = <bdi dir="rtl" lang="he">{masechtaHe(id)}</bdi>;
  if (state.s !== "failed") return <Frame><p className="hint">Loading {name}…</p></Frame>;
  const retry = <button className="btn primary big" onClick={() => setAttempt((n) => n + 1)}>Retry</button>;
  const other = onChooseOther && <button className="btn ghost-btn" onClick={onChooseOther}>Choose a different masechta</button>;
  return (
    <Frame>
      {state.kind === "offline" ? (
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
      {retry}
      {other}
    </Frame>
  );
}

