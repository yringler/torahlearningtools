import { useState } from "react";
import type { LearningEventBody, User } from "../../shared/api";
import { api, ApiFailure, NetworkFailure } from "../api/client";
import { MASECHTA, mishnayosOf, PERAKIM } from "../data";
import { copyAsNew, normalizeProfile } from "../legacy/import";
import { dueReviews, isKnown, mp, pp, resetMishnah } from "../progress";
import { EMOJIS, isAppState, newProfile } from "../storage";
import type { SyncStatus } from "../sync/engine";
import type { ProfilesUpdate } from "../sync/useAccount";
import type { AppState, Profile } from "../types";
import { ChildHistory } from "./ChildHistory";

interface Props {
  user: User;
  profiles: Profile[];
  setProfiles: (next: ProfilesUpdate) => void;
  onEvent: (childId: string, body: LearningEventBody) => void;
  status: SyncStatus;
  syncNow: () => Promise<void>;
  pendingNow: () => number;
  /** Stops syncing and removes this account's data from the device. */
  endSession: () => void;
  /** After sign-out or account deletion. */
  onSignOut: () => void;
  onSignInAgain: () => void;
  hasLegacy: boolean;
  onReopenImport: () => void;
  onBack: () => void;
}

function ago(ms: number): string {
  const min = Math.floor((Date.now() - ms) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(ms).toLocaleDateString();
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const kids = (n: number) => (n === 1 ? "1 child" : `${n} children`);

function statusText(s: SyncStatus): string {
  const waiting = s.pending > 0 ? `${plural(s.pending, "change")} waiting` : "";
  switch (s.state) {
    case "signedOut": return "Sign in again to sync";
    case "offline": return waiting ? `Offline: ${waiting}` : "Offline";
    case "error": return waiting ? `Couldn't sync: ${waiting}` : "Couldn't sync some changes";
    case "syncing": return "Syncing…";
    case "idle":
      if (waiting) return waiting;
      return s.lastSyncAt ? `Synced ${ago(s.lastSyncAt)}` : "Not synced yet";
  }
}

export function Parent(props: Props) {
  const { profiles, setProfiles, onEvent, status, onBack } = props;
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");

  const update = (p: Profile) => setProfiles((list) => list.map((x) => (x.id === p.id ? p : x)));

  const add = () => {
    const n = name.trim();
    if (!n) return;
    setProfiles((list) => [...list, newProfile(n, list.length)]);
    setName("");
  };

  const exportJson = () => {
    const state: AppState = { version: 1, profiles };
    const blob = new Blob([JSON.stringify(state, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `baalpeh-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJson = async (f: File | undefined) => {
    if (!f) return;
    try {
      const parsed: unknown = JSON.parse(await f.text());
      if (!isAppState(parsed)) throw new Error("bad file");
      const n = parsed.profiles.length;
      if (n === 0) { setMsg("That backup has no children in it."); return; }
      if (confirm(`Add ${kids(n)} from this backup?`)) {
        const copies = copyAsNew(parsed.profiles.map(normalizeProfile));
        setProfiles((list) => [...list, ...copies]);
        setMsg(`Added ${kids(n)}.`);
      }
    } catch {
      setMsg("That file isn't a Ba'al Peh backup.");
    }
  };

  return (
    <div className="parent" dir="ltr">
      <div className="topbar">
        <button className="btn ghost-btn small" onClick={onBack}>‹ Back</button>
        <span className="who">Parent area</span>
      </div>

      <section>
        <h3>Children</h3>
        {profiles.map((p) => <ChildCard key={p.id} p={p} onChange={update} online={status.state !== "offline"}
          onReset={(perek, mishnah) => onEvent(p.id, { type: "reset", perek, mishnah })}
          onDelete={() => confirm(`Delete ${p.name} and all their progress?`) && setProfiles((list) => list.filter((x) => x.id !== p.id))} />)}
        <div className="row">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Child's name" maxLength={40} onKeyDown={(e) => e.key === "Enter" && add()} />
          <button className="btn primary" onClick={add}>Add child</button>
        </div>
      </section>

      <AccountSection {...props} />

      <section>
        <h3>Backup</h3>
        <p className="hint">Progress is saved to your account and on this device.</p>
        <div className="row">
          <button className="btn secondary" onClick={exportJson}>⬇ Export backup</button>
          <label className="btn secondary">⬆ Import backup<input type="file" accept="application/json" hidden onChange={(e) => void importJson(e.target.files?.[0])} /></label>
        </div>
        {msg && <p>{msg}</p>}
      </section>

      {props.hasLegacy && (
        <section>
          <h3>Move from this device</h3>
          <p className="hint">This device has progress saved without an account (from guest mode or before accounts). You can add it to your account.</p>
          <button className="btn secondary" onClick={props.onReopenImport}>Move progress to my account</button>
        </section>
      )}

      <section>
        <h3>How it works</h3>
        <ul className="hint">
          <li>Each mishnah is cut into small pieces. The child learns piece 1, piece 2, then 1+2 together, piece 3, then 1–3… Long mishnayos are learned in parts, then the parts are joined.</li>
          <li>Hints fade: full text → first letters → first word → nothing. Tapping a hidden card is a "peek", and peeks are counted automatically.</li>
          <li>At the end of each mishnah, and for each "mishnayos 1–k in a row" chain, you listen and grade. A perek is done when it's said in one shot.</li>
          <li>Learned mishnayos come back for review after 1, 3, 7, 14, 30 and 60 days. A finished perek is reviewed as a whole.</li>
          <li>Hebrew text: Torat Emet via Sefaria. Meanings come in two views. <b>Steinsaltz</b> is quoted word for word from the Koren Noé / William Davidson translation (bold = translation, light = explanation). <b>Simple</b> is an AI simplification of Steinsaltz, checked against Bartenura (tr. R. Shraga Silverstein). Tap ⓘ by any meaning to see its source. Please check anything that looks off.</li>
        </ul>
      </section>
    </div>
  );
}

function AccountSection({ user, status, syncNow, pendingNow, endSession, onSignOut, onSignInAgain }: Props) {
  const [busy, setBusy] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [error, setError] = useState("");
  const emailMatches = confirmEmail.trim().toLowerCase() === user.email.toLowerCase();

  const signOut = async () => {
    setBusy(true);
    setError("");
    try { await syncNow(); } catch { /* reported through status */ }
    const left = pendingNow();
    if (left > 0 && !confirm(`${plural(left, "change")} haven't reached the server and will be lost. Sign out anyway?`)) {
      setBusy(false);
      return;
    }
    try { await api.logout(); } catch { /* offline: the cookie stays, but local data is cleared */ }
    endSession();
    onSignOut();
  };

  const deleteAccount = async () => {
    if (!emailMatches) return;
    if (!confirm("Delete this account and all children's progress on every device? This can't be undone.")) return;
    setBusy(true);
    setError("");
    try {
      await api.deleteAccount({ email: confirmEmail.trim() });
    } catch (e) {
      setBusy(false);
      if (e instanceof NetworkFailure) setError("You're offline. Connect to the internet to delete the account.");
      else if (e instanceof ApiFailure && e.status === 401) setError("Sign in again first, then delete the account.");
      else if (e instanceof ApiFailure && e.status === 400) setError("The email doesn't match this account.");
      else setError("Something went wrong. Try again.");
      return;
    }
    endSession();
    onSignOut();
  };

  return (
    <section>
      <h3>Account</h3>
      <p>Signed in as <b>{user.email}</b></p>
      <div className="row">
        <span className={`sync-dot inline ${status.state}`} aria-hidden="true" />
        <span className="sync-text">{statusText(status)}</span>
        {status.state === "signedOut" ? (
          <button className="btn secondary small" onClick={onSignInAgain}>Sign in again</button>
        ) : (
          <button className="btn secondary small" disabled={status.state === "syncing"} onClick={() => void syncNow()}>Sync now</button>
        )}
      </div>
      <div className="row">
        <button className="btn secondary" disabled={busy} onClick={() => void signOut()}>Sign out of this device</button>
      </div>
      <details>
        <summary>Delete account</summary>
        <p className="hint">This deletes the account and every child's progress from the server. Type <b>{user.email}</b> to confirm.</p>
        <div className="row">
          <input type="email" value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} placeholder={user.email} aria-label="Type your email to confirm" autoComplete="off" />
          <button className="btn ghost-btn danger" disabled={!emailMatches || busy} onClick={() => void deleteAccount()}>Delete account</button>
        </div>
      </details>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}

function ChildCard({ p, onChange, onDelete, onReset, online }: {
  p: Profile; onChange: (p: Profile) => void; onDelete: () => void; onReset: (perek: number, mishnah: number) => void; online: boolean;
}) {
  const [open, setOpen] = useState<"settings" | "history" | null>(null);
  const known = Object.values(p.mishnayos).filter(isKnown).length;
  const total = MASECHTA.mishnayos.length;
  const perakimDone = PERAKIM.filter((x) => pp(p, x).complete).length;
  const set = <K extends keyof Profile["settings"]>(k: K, v: Profile["settings"][K]) => onChange({ ...p, settings: { ...p.settings, [k]: v } });
  const toggle = (v: "settings" | "history") => setOpen(open === v ? null : v);
  return (
    <div className="child-card" style={{ borderColor: p.color }}>
      <div className="row between">
        <b style={{ color: p.color }}>{p.emoji} {p.name}</b>
        <span>{known}/{total} mishnayos · {perakimDone} perakim · {dueReviews(p).length} due</span>
        <span className="row">
          <button className="btn ghost-btn small" onClick={() => toggle("history")}>{open === "history" ? "Close" : "History"}</button>
          <button className="btn ghost-btn small" onClick={() => toggle("settings")}>{open === "settings" ? "Close" : "Settings"}</button>
        </span>
      </div>
      {open === "history" && <ChildHistory profile={p} online={online} />}
      {open === "settings" && (
        <div className="child-settings">
          <label>Name <input value={p.name} maxLength={40} onChange={(e) => onChange({ ...p, name: e.target.value })} /></label>
          <label>Picture
            <select value={p.emoji} onChange={(e) => onChange({ ...p, emoji: e.target.value })}>
              {EMOJIS.map((e) => <option key={e}>{e}</option>)}
            </select>
          </label>
          <label>Text size <input type="range" min={0.8} max={1.6} step={0.1} value={p.settings.fontScale} onChange={(e) => set("fontScale", Number(e.target.value))} /></label>
          <label>Session minutes <input type="number" min={5} max={60} value={p.settings.dailyMinutes} onChange={(e) => set("dailyMinutes", Number(e.target.value) || 15)} /></label>
          <label>Meanings while learning
            <select value={p.settings.meaningView ?? "simple"} onChange={(e) => set("meaningView", e.target.value === "steinsaltz" ? "steinsaltz" : "simple")}>
              <option value="simple">Simple (for young readers)</option>
              <option value="steinsaltz">Steinsaltz (bold translation + explanation)</option>
            </select>
          </label>
          <label><input type="checkbox" checked={p.settings.tts} onChange={(e) => set("tts", e.target.checked)} /> 🔊 Read-aloud (approximate: Israeli pronunciation, may skip nikud)</label>
          <details>
            <summary>Reset a mishnah</summary>
            {PERAKIM.map((perek) => (
              <div key={perek} className="row wrap">
                <span>Perek {perek}:</span>
                {mishnayosOf(perek).map((m) => (
                  <button key={m.mishnah} className={`btn small ${mp(p, perek, m.mishnah).state}`}
                    onClick={() => {
                      if (!confirm(`Reset ${perek}:${m.mishnah}?`)) return;
                      onChange(resetMishnah(p, perek, m.mishnah));
                      onReset(perek, m.mishnah);
                    }}>
                    {m.mishnah}
                  </button>
                ))}
              </div>
            ))}
          </details>
          <button className="btn ghost-btn danger" onClick={onDelete}>Delete {p.name}</button>
        </div>
      )}
    </div>
  );
}
