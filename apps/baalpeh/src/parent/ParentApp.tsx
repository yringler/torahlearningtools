import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ParentMeResponse, User } from "../../shared/api";
import { api, ApiFailure, errorCode, NetworkFailure } from "../api/client";
import { ConfirmSheet } from "../components/ConfirmSheet";
import { PinPad, type PinOutcome } from "../components/PinPad";
import { hebNum, MASECHTA, PERAKIM } from "../data";
import { kv } from "../kv";
import { canImportDevice, normalizeProfile } from "../legacy/import";
import { frontier, gatedDueReviews, isKnown, perekPhase } from "../progress";
import { ImportPrompt } from "../screens/ImportPrompt";
import { EMOJIS, loadLegacy, newProfile } from "../storage";
import { SyncEngine } from "../sync/engine";
import { loadCurrentUser, loadStore, pendingCount, saveStore, setCurrentUser, storeKey, type AccountStore, type LastTest } from "../sync/store";
import type { Profile } from "../types";
import { ChangeLog } from "./ChangeLog";
import { ChildDetail, type ChildTab } from "./ChildDetail";
import { ParentSettings } from "./ParentSettings";
import { lockDecision, timeZone } from "./pin";
import { ForgotPin, PinSetup, pinOutcomeOf, setPinFailText } from "./PinFlows";
import { useParent } from "./useParent";

interface Props {
  me: ParentMeResponse;
  /** A learner session of the same account on this device (from learner mode, or the cached user), or null. */
  learner: User | null;
  /** Go to learner mode as this user (the shell sets the current user). */
  onToLearner: (user: User) => void;
  /** The parent session is gone (401): sign in as parent by email again. */
  onSignedOut: () => void;
  /** Back to the login choice (signed out, account deleted). */
  onChoose: () => void;
}

type Tab = "children" | "log" | "settings";

/**
 * Parent mode (docs/PARENT_MODE.md §9.4): a separate area with no learning screens. It opens locked, always asks for
 * the PIN, and re-locks after 5 minutes without input, a minute hidden, or on leaving. Locking unmounts the content
 * but keeps the in-memory data, so unlocking returns to the same place.
 */
export function ParentApp({ me: me0, learner: learner0, onToLearner, onSignedOut, onChoose }: Props) {
  const [me, setMe] = useState(me0);
  const [unlocked, setUnlocked] = useState(false);
  const [pinDone, setPinDone] = useState<null | "set" | "changed">(null);
  const [changingPin, setChangingPin] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [tab, setTab] = useState<Tab>("children");
  const [childId, setChildId] = useState<string | null>(null);
  const [childTab, setChildTab] = useState<ChildTab>("perakim");
  const [toast, setToast] = useState("");
  const [askLearner, setAskLearner] = useState(false);
  const learner = learner0 && learner0.id === me.user.id ? learner0 : null;

  const lockLocal = useCallback(() => { setUnlocked(false); setChangingPin(false); }, []);
  const lock = useCallback(() => {
    void api.parentLock().catch(() => undefined);
    lockLocal();
  }, [lockLocal]);

  const data = useParent(me.user, { locked: lockLocal, signedOut: onSignedOut });

  // Opening parent mode always asks for the PIN, even if this session was still unlocked (§3.2).
  useEffect(() => { void api.parentLock().catch(() => undefined); }, []);

  // First full pull, and a retry of anything pending, whenever the PIN is entered.
  const syncRef = useRef(data.sync);
  syncRef.current = data.sync;
  useEffect(() => { if (unlocked) void syncRef.current(); }, [unlocked]);

  // Re-lock timers, the ping, and the beacon on leaving the page (§3.3).
  useEffect(() => {
    if (!unlocked) return;
    let lastInputAt = Date.now();
    let lastPingAt = Date.now();
    let hiddenSince: number | null = document.visibilityState === "hidden" ? Date.now() : null;
    const input = () => { lastInputAt = Date.now(); };
    const vis = () => { hiddenSince = document.visibilityState === "hidden" ? hiddenSince ?? Date.now() : null; };
    const leave = () => { void api.parentLock().catch(() => undefined); };
    const tick = setInterval(() => {
      const d = lockDecision({ lastInputAt, hiddenSince, lastPingAt, now: Date.now() });
      if (d.lock) { lock(); return; }
      if (d.ping) {
        lastPingAt = Date.now();
        api.parentMe().then(
          (r) => { setMe(r); if (r.unlockedUntil === null) lockLocal(); },
          (e: unknown) => { if (e instanceof ApiFailure && e.status === 401) onSignedOut(); },
        );
      }
    }, 1000);
    window.addEventListener("pointerdown", input);
    window.addEventListener("keydown", input);
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("pagehide", leave);
    return () => {
      clearInterval(tick);
      window.removeEventListener("pointerdown", input);
      window.removeEventListener("keydown", input);
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("pagehide", leave);
    };
  }, [unlocked, lock, lockLocal, onSignedOut]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const unlock = async (pin: string): Promise<PinOutcome> => {
    try {
      const r = await api.parentUnlock({ pin });
      setMe(r);
      setUnlocked(true);
      return { ok: true };
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 401) { onSignedOut(); return { ok: true }; }
      if (errorCode(e) === "pin_not_set") { setMe((m) => ({ ...m, pin: { set: false, locked: false } })); return { ok: true }; }
      const out = pinOutcomeOf(e);
      if ("locked" in out) setMe((m) => ({ ...m, pin: { ...m.pin, locked: true } }));
      return out;
    }
  };

  const savePin = async (pin: string): Promise<string | null> => {
    try {
      const tz = timeZone();
      const r = await api.parentSetPin({ pin, ...(tz ? { tz } : {}) });
      const first = !me.pin.set;
      setMe(r);
      setUnlocked(true);
      setChangingPin(false);
      setPinDone(first ? "set" : "changed");
      return null;
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 401) { onSignedOut(); return null; }
      if (errorCode(e) === "parent_locked") { lockLocal(); return null; }
      if (errorCode(e) === "pin_locked") { setMe((m) => ({ ...m, pin: { ...m.pin, locked: true } })); lockLocal(); return null; }
      return setPinFailText(e);
    }
  };

  const confirmLeave = (): boolean => {
    const n = data.pendingNow();
    return n === 0 || confirm("Some changes haven't been saved yet. Leave anyway?");
  };
  const backToLearning = () => {
    if (!learner || !confirmLeave()) return;
    lock();
    onToLearner(learner);
  };

  const forgotSheet = forgot && (
    <ForgotPin email={me.user.email} onClose={() => setForgot(false)} send={async () => (await api.parentForgotPin()).sentTo} />
  );
  const backButton = learner && <button className="btn ghost-btn" onClick={backToLearning}>‹ Back to learning</button>;

  // ── The PIN gate ──
  if (!me.pin.set) {
    return (
      <ParentFrame>
        <PinSetup title="Choose your parent PIN" save={savePin}
          intro={<p>4 digits. You'll need them to open parent mode and to confirm a perek test. Keep it to yourself, not with the children.</p>} />
        {backButton}
      </ParentFrame>
    );
  }
  if (me.pin.locked) {
    return (
      <ParentFrame>
        <div className="pin-screen">
          <div className="big-emoji">🔒</div>
          <h2>Your parent PIN is locked after 5 wrong tries.</h2>
          <p>We'll email <b>{me.user.email}</b> a link to choose a new PIN.</p>
          <button className="btn primary big" onClick={() => setForgot(true)}>Email me a reset link</button>
          <button className="btn ghost-btn small" onClick={() => void api.parentMe().then(setMe, () => undefined)}>I've chosen a new PIN</button>
          {learner ? backButton : <button className="btn ghost-btn" onClick={onChoose}>Cancel</button>}
        </div>
        {forgotSheet}
      </ParentFrame>
    );
  }
  if (!unlocked) {
    return (
      <ParentFrame>
        <div className="pin-screen">
          <h2>Enter your parent PIN</h2>
          <PinPad onSubmit={unlock} onForgot={() => setForgot(true)} />
          {backButton}
        </div>
        {forgotSheet}
      </ParentFrame>
    );
  }
  if (pinDone !== null) {
    return (
      <ParentFrame>
        <div className="pin-screen">
          <div className="big-emoji">✓</div>
          <h2>{pinDone === "set" ? "Your PIN is set." : "Your PIN was changed."}</h2>
          <p>{pinDone === "set"
            ? <>We sent a note to <b>{me.user.email}</b>, so you'll always know when the PIN changes.</>
            : <>We emailed <b>{me.user.email}</b> a note.</>}</p>
          <button className="btn primary big" onClick={() => setPinDone(null)}>Continue</button>
        </div>
      </ParentFrame>
    );
  }
  if (changingPin) {
    return (
      <ParentFrame>
        <PinSetup title="Choose a new PIN" save={savePin} />
        <button className="btn ghost-btn" onClick={() => setChangingPin(false)}>Cancel</button>
      </ParentFrame>
    );
  }

  // ── Unlocked ──
  const offlineFirst = data.problem === "offline" && !data.loaded;
  const child = childId ? data.profiles.find((p) => p.id === childId) : undefined;

  const signOutDevice = async () => {
    const cur = loadCurrentUser(kv);
    if (cur) {
      let s: AccountStore = loadStore(kv, cur);
      if (pendingCount(s) > 0) {
        const engine = new SyncEngine({ api, get: () => s, set: (x) => { s = x; saveStore(kv, x); }, onStatus: () => undefined });
        try { await engine.syncNow(); } catch { /* counted below */ }
        engine.stop();
        const left = pendingCount(s);
        if (left > 0 && !confirm(`${left} learning change${left === 1 ? "" : "s"} on this device haven't reached the server and will be lost. Sign out anyway?`)) return;
      }
    }
    await api.logout().catch(() => undefined);
    await api.parentLogout().catch(() => undefined);
    if (cur) { try { kv.removeItem(storeKey(cur.id)); } catch { /* ignore */ } }
    setCurrentUser(kv, null);
    onChoose();
  };

  const deleteAccount = async (email: string) => {
    try {
      await api.parentDeleteAccount({ email });
    } catch (e) {
      if (e instanceof NetworkFailure) throw new Error("You're offline. Connect to the internet to delete the account.");
      if (e instanceof ApiFailure && e.status === 403) { lockLocal(); throw new Error("Enter your PIN again first."); }
      if (e instanceof ApiFailure && e.status === 400) throw new Error("The email doesn't match this account.");
      throw new Error("Something went wrong. Try again.");
    }
    try { kv.removeItem(storeKey(me.user.id)); } catch { /* ignore */ }
    setCurrentUser(kv, null);
    onChoose();
  };

  const setVerified = async (id: string, perakim: number[], verified: boolean) => {
    try {
      await data.setVerified(id, perakim, verified);
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 403) { lockLocal(); throw new Error("Enter your PIN again first."); }
      if (e instanceof ApiFailure && e.status === 401) { onSignedOut(); throw new Error("Sign in again."); }
      if (e instanceof ApiFailure && e.status === 404) throw new Error("This child hasn't reached the server yet. Try again in a moment.");
      if (e instanceof NetworkFailure) throw new Error("You're offline. Connect and try again.");
      throw new Error("Something went wrong. Try again.");
    }
  };

  let content: JSX.Element;
  if (offlineFirst) {
    content = (
      <section className="card-section">
        <p>Parent mode needs an internet connection. Connect and try again.</p>
        <div className="row">
          <button className="btn primary" onClick={() => void data.sync()}>Retry</button>
          {backButton}
        </div>
      </section>
    );
  } else if (!data.loaded) {
    content = <p className="hint">Loading…</p>;
  } else if (tab === "children" && child) {
    content = (
      <ChildDetail
        key={child.id}
        profile={child}
        verified={data.verifiedFor(child.id)}
        verifiedAt={(perek) => data.verifiedAt(child.id, perek)}
        lastTest={learnerLastTest(learner, child.id)}
        now={Date.now()}
        online={data.problem !== "offline"}
        save={(np, events) => data.edit((list) => list.map((x) => (x.id === np.id ? np : x)), (events ?? []).map((body) => ({ childId: np.id, body })))}
        remove={() => { data.edit((list) => list.filter((x) => x.id !== child.id)); setChildId(null); setToast(`${child.name} was removed.`); }}
        setVerified={(perakim, verified) => setVerified(child.id, perakim, verified)}
        onBack={() => setChildId(null)}
        toast={setToast}
        tab={childTab}
        onTab={setChildTab}
      />
    );
  } else if (tab === "children") {
    content = <ChildrenTab profiles={data.profiles} data={data} onOpen={(id) => { setChildId(id); setChildTab("perakim"); }} toast={setToast} learner={learner} />;
  } else if (tab === "log") {
    content = <ChangeLog accountEmail={me.user.email} onLocked={lockLocal} />;
  } else {
    content = (
      <ParentSettings
        me={me}
        profiles={data.profiles}
        onChangePin={() => setChangingPin(true)}
        onForgotPin={() => setForgot(true)}
        onLock={lock}
        onParentLogout={() => {
          if (!confirmLeave()) return;
          void api.parentLogout().catch(() => undefined).then(() => (learner ? onToLearner(learner) : onChoose()));
        }}
        onSignOutDevice={signOutDevice}
        onDeleteAccount={deleteAccount}
        addChildren={(copies) => data.edit((list) => [...list, ...copies])}
      />
    );
  }

  return (
    <div className="parent-app" dir="ltr">
      <div className="topbar parent-top">
        <span className="parent-title">
          <b>Parent mode</b>
          <span className="login-email">{me.loginEmail}</span>
        </span>
        <span className="row tight">
          {data.saving && <span className="saving" role="status">Saving…</span>}
          <button className="btn secondary small" onClick={lock}>🔒 Lock</button>
        </span>
      </div>
      <div className="segmented main-tabs" role="tablist" aria-label="Parent mode">
        {(["children", "log", "settings"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""}
            onClick={() => { setTab(t); if (t !== "children") setChildId(null); }}>
            {t === "children" ? "Children" : t === "log" ? "Change log" : "Settings"}
          </button>
        ))}
      </div>
      {data.loaded && data.problem === "offline" && (
        <p className="notice" role="alert">You're offline. Your last change hasn't been saved. <button className="link-btn" onClick={() => void data.sync()}>Retry</button></p>
      )}
      {data.problem === "error" && (
        <p className="notice" role="alert">Couldn't reach the server. <button className="link-btn" onClick={() => void data.sync()}>Retry</button></p>
      )}
      {data.problem === "rejected" && <p className="notice" role="alert">That change couldn't be saved.</p>}

      {content}

      <div className="parent-bottom">
        {learner
          ? <button className="btn secondary" onClick={backToLearning}>📖 Back to learning</button>
          : <button className="btn secondary" onClick={() => setAskLearner(true)}>📖 Use this device for learning</button>}
      </div>

      {toast && <div className="toast" role="status">{toast}</div>}
      {forgotSheet}
      {askLearner && (
        <ConfirmSheet title="Open learner mode on this device?" action="Open learner mode" onCancel={() => setAskLearner(false)}
          onAct={async () => {
            if (!confirmLeave()) { setAskLearner(false); return; }
            let user: User;
            try {
              user = (await api.parentLearnerSession()).user;
            } catch (e) {
              if (e instanceof ApiFailure && e.status === 403) { setAskLearner(false); lockLocal(); return; }
              throw new Error(e instanceof NetworkFailure ? "You're offline. Connect and try again." : "Something went wrong. Try again.");
            }
            lock();
            onToLearner(user);
          }}>
          <p>Children will be able to learn here and change text size. Everything else stays in parent mode, behind your PIN.</p>
        </ConfirmSheet>
      )}
    </div>
  );
}

function ParentFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth parent-gate" dir="ltr">
      <h1 className="app-title"><span dir="rtl">משנה בעל פה</span></h1>
      <p className="parent-gate-label">Parent mode</p>
      <div className="auth-card">{children}</div>
    </div>
  );
}

/** "📬 Test email sent" needs this device's learner store (the server doesn't say when a test was sent). */
function learnerLastTest(learner: User | null, childId: string): LastTest | undefined {
  if (!learner) return undefined;
  return loadStore(kv, learner).lastTest?.[childId];
}

/** "{known}/{total} mishnayos · {verified} perakim verified · {due} due" (§9.7). */
export function childSummary(p: Profile, verified: ReadonlySet<number>): { line: string; waiting: number | null } {
  const known = Object.values(p.mishnayos).filter(isKnown).length;
  const total = MASECHTA.mishnayos.length;
  const nVerified = PERAKIM.filter((x) => verified.has(x)).length;
  const due = gatedDueReviews(p, verified).length;
  const f = frontier(verified);
  const waiting = f !== null && perekPhase(p, verified, f) === "test" ? f : null;
  return { line: `${known}/${total} mishnayos · ${nVerified} ${nVerified === 1 ? "perek" : "perakim"} verified · ${due} due`, waiting };
}

function ChildrenTab({ profiles, data, onOpen, toast, learner }: {
  profiles: Profile[];
  data: ReturnType<typeof useParent>;
  onOpen: (id: string) => void;
  toast: (m: string) => void;
  learner: User | null;
}) {
  const [adding, setAdding] = useState(false);
  const legacy = useMemo(() => loadLegacy().profiles.map(normalizeProfile), []);
  const canImport = canImportDevice(legacy.length, profiles.length, data.loaded ? 1 : null);
  const add = (name: string, emoji: string) => {
    data.edit((list) => [...list, { ...newProfile(name, list.length), emoji }]);
    toast(learner ? `${name} was added. Pick ${name} in learner mode to begin.` : `${name} was added.`);
  };

  if (profiles.length === 0) {
    return (
      <>
        <section className="card-section">
          <h2>Add your first child</h2>
          <p className="hint">Each child gets their own place to learn and review, on every device signed in to this account.</p>
          <AddChildForm onAdd={add} />
        </section>
        {canImport && <ImportPrompt inline legacy={legacy} existing={profiles} onImport={(sel) => { data.importLegacy(sel); toast("Moved to your account."); }} />}
      </>
    );
  }
  return (
    <>
      <ul className="child-list">
        {profiles.map((p) => {
          const s = childSummary(p, data.verifiedFor(p.id));
          return (
            <li key={p.id}>
              <button className="child-card-btn" style={{ borderColor: p.color }} onClick={() => onOpen(p.id)}>
                <span className="child-emoji">{p.emoji}</span>
                <span className="child-text">
                  <b style={{ color: p.color }}>{p.name}</b>
                  <span className="hint-line">{s.line}</span>
                  {s.waiting !== null && <span className="hint-line"><bdi dir="rtl">פרק {hebNum(s.waiting)}</bdi> learned, waiting for a test</span>}
                </span>
                <span className="chev" aria-hidden="true">›</span>
              </button>
            </li>
          );
        })}
      </ul>
      <button className="btn secondary" onClick={() => setAdding(true)}>+ Add child</button>
      {adding && (
        <div className="sheet-backdrop confirm" role="dialog" aria-modal="true" aria-labelledby="add-title" onClick={() => setAdding(false)}>
          <div className="sheet confirm-sheet" dir="ltr" onClick={(e) => e.stopPropagation()}>
            <h3 id="add-title">Add a child</h3>
            <AddChildForm onAdd={(n, e) => { add(n, e); setAdding(false); }} onCancel={() => setAdding(false)} />
          </div>
        </div>
      )}
    </>
  );
}

function AddChildForm({ onAdd, onCancel }: { onAdd: (name: string, emoji: string) => void; onCancel?: () => void }) {
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState<string>(EMOJIS[0]);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    onAdd(n, emoji);
    setName("");
  };
  return (
    <form className="add-child" onSubmit={submit}>
      <label className="field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Child's name" maxLength={40} autoFocus />
      </label>
      <div className="emoji-pick" role="radiogroup" aria-label="Picture">
        {EMOJIS.map((e) => (
          <button key={e} type="button" role="radio" aria-checked={emoji === e} className={emoji === e ? "on" : ""} onClick={() => setEmoji(e)}>{e}</button>
        ))}
      </div>
      <div className="confirm-actions">
        {onCancel && <button type="button" className="btn secondary" onClick={onCancel}>Cancel</button>}
        <button className="btn primary" type="submit" disabled={!name.trim()}>Add</button>
      </div>
    </form>
  );
}
