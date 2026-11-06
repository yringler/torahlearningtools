import { useEffect, useState } from "react";
import type { AuditEntry } from "../../shared/api";
import { api, ApiFailure, NetworkFailure } from "../api/client";
import { actorLine, describeEntry, whenText } from "./log";

type Load = { s: "loading" } | { s: "ok" } | { s: "offline" } | { s: "error" };

/** Parent mode's change log (docs/PARENT_MODE.md §9.9): newest first, 30 at a time. */
export function ChangeLog({ accountEmail, onLocked }: { accountEmail: string; onLocked: () => void }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [load, setLoad] = useState<Load>({ s: "loading" });
  const [more, setMore] = useState(false);
  const [tryN, setTryN] = useState(0);

  const fail = (e: unknown): Load => {
    if (e instanceof ApiFailure && e.status === 403) onLocked();
    return e instanceof NetworkFailure ? { s: "offline" } : { s: "error" };
  };

  useEffect(() => {
    let cancelled = false;
    setLoad({ s: "loading" });
    api.parentLog().then(
      (r) => { if (!cancelled) { setEntries(r.entries); setNext(r.nextBefore); setLoad({ s: "ok" }); } },
      (e: unknown) => { if (!cancelled) setLoad(fail(e)); },
    );
    return () => { cancelled = true; };
  }, [tryN]); // eslint-disable-line react-hooks/exhaustive-deps

  const showMore = async () => {
    if (next === null) return;
    setMore(true);
    try {
      const r = await api.parentLog(next);
      setEntries((list) => [...list, ...r.entries.filter((e) => !list.some((x) => x.id === e.id))]);
      setNext(r.nextBefore);
    } catch (e) {
      fail(e);
    }
    setMore(false);
  };

  return (
    <section className="card-section change-log">
      <h3>Change log</h3>
      {load.s === "loading" && <p className="hint">Loading…</p>}
      {load.s === "offline" && <p className="hint">You're offline. <button className="link-btn" onClick={() => setTryN((n) => n + 1)}>Retry</button></p>}
      {load.s === "error" && <p className="hint">Couldn't load the change log. <button className="link-btn" onClick={() => setTryN((n) => n + 1)}>Retry</button></p>}
      {load.s === "ok" && entries.length === 0 && <p className="hint">Nothing here yet. Changes made in parent mode will show up here.</p>}
      {entries.length > 0 && (
        <ul className="log-list">
          {entries.map((e) => (
            <li key={e.id}>
              <div><span className="when">{whenText(e.at)}</span> · {describeEntry(e)}</div>
              <div className="log-who">{actorLine(e)}</div>
            </li>
          ))}
        </ul>
      )}
      {next !== null && <button className="btn ghost-btn small" disabled={more} onClick={() => void showMore()}>{more ? "Loading…" : "Show more"}</button>}
      <p className="hint">Every PIN change is also emailed to <b>{accountEmail}</b>.</p>
    </section>
  );
}
