import { useState } from "react";
import type { ParentMeResponse } from "../../shared/api";
import { AboutNote, LicensesLink, PricingNote } from "../components/Licenses";
import { copyAsNew, normalizeProfile } from "../legacy/import";
import { IMPORT_TEST_NOTE } from "../perekTest";
import { isAppState } from "../storage";
import type { AppState, Profile } from "../types";

interface Props {
  me: ParentMeResponse;
  profiles: Profile[];
  onChangePin: () => void;
  onForgotPin: () => void;
  onLock: () => void;
  /** Ends the parent session on this device. */
  onParentLogout: () => void;
  /** Ends both sessions and removes the learner data from this device. */
  onSignOutDevice: () => Promise<void>;
  /** DELETE /api/parent/account; throws an Error with the text to show. */
  onDeleteAccount: (email: string) => Promise<void>;
  addChildren: (copies: Profile[]) => void;
}

const kids = (n: number) => (n === 1 ? "1 child" : `${n} children`);

/** Parent mode's Settings tab (docs/PARENT_MODE.md §9.10). */
export function ParentSettings(props: Props) {
  const { me, profiles } = props;
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [error, setError] = useState("");
  const emailMatches = confirmEmail.trim().toLowerCase() === me.user.email.toLowerCase();

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
        props.addChildren(copyAsNew(parsed.profiles.map(normalizeProfile)));
        setMsg(`Added ${kids(n)}. ${IMPORT_TEST_NOTE}`);
      }
    } catch {
      setMsg("That file isn't a Ba'al Peh backup.");
    }
  };

  const deleteAccount = async () => {
    if (!emailMatches) return;
    if (!confirm("Delete this account and all children's progress on every device? This can't be undone.")) return;
    setBusy(true);
    setError("");
    try {
      await props.onDeleteAccount(confirmEmail.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  };

  return (
    <div className="parent-settings">
      <section className="card-section">
        <h3>Parent PIN</h3>
        <p className="hint">Needed to open parent mode and to confirm a perek test. Every change is emailed to <b>{me.user.email}</b>.</p>
        <div className="row">
          <button className="btn secondary" onClick={props.onChangePin}>Change PIN</button>
          <button className="btn ghost-btn" onClick={props.onForgotPin}>Forgot PIN?</button>
        </div>
      </section>

      <section className="card-section">
        <h3>Account</h3>
        <p>Signed in as <b>{me.loginEmail}</b></p>
        <PricingNote />
      </section>

      <section className="card-section">
        <h3>Backup</h3>
        <p className="hint">Progress is saved to your account. A backup file is an extra copy.</p>
        <div className="row">
          <button className="btn secondary" onClick={exportJson}>⬇ Export backup</button>
          <label className="btn secondary">⬆ Import backup<input type="file" accept="application/json" hidden onChange={(e) => void importJson(e.target.files?.[0])} /></label>
        </div>
        {msg && <p>{msg}</p>}
      </section>

      <section className="card-section">
        <h3>This device</h3>
        <div className="stack">
          <button className="btn secondary" onClick={props.onLock}>🔒 Lock parent mode</button>
          <button className="btn secondary" onClick={props.onParentLogout}>Sign out of parent mode on this device</button>
          <p className="hint">Next time, parent mode needs the sign-in email again.</p>
          <button className="btn ghost-btn" disabled={busy} onClick={() => { setBusy(true); void props.onSignOutDevice().finally(() => setBusy(false)); }}>
            Sign this device out completely
          </button>
        </div>
      </section>

      <section className="card-section">
        <details>
          <summary>Delete account</summary>
          <p className="hint">This deletes the account and every child's progress from the server. Type <b>{me.user.email}</b> to confirm.</p>
          <div className="row">
            <input type="email" value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} placeholder={me.user.email}
              aria-label="Type your email to confirm" autoComplete="off" />
            <button className="btn ghost-btn danger" disabled={!emailMatches || busy} onClick={() => void deleteAccount()}>Delete account</button>
          </div>
          {error && <p className="error" role="alert">{error}</p>}
        </details>
      </section>

      <section className="card-section">
        <h3>How it works</h3>
        <ul className="hint">
          <li>Each mishnah is cut into small pieces. The child learns piece 1, piece 2, then 1+2 together, piece 3, then 1–3… Long mishnayos are learned in parts, then the parts are joined.</li>
          <li>Hints fade: full text → first letters → first word → nothing. Tapping a hidden card is a "peek", and peeks are counted automatically.</li>
          <li>At the end of each mishnah you listen and grade. Mishnayos are then built up the same way: 1, 2, 1+2, 3, 1–3… up to the whole perek.</li>
          <li>When your child finishes a perek, they tap "I'm ready to show Abba or Ima" and you get an email with the text. Listen, then tap the link and enter your PIN. Only then does the next perek open. You can also mark a perek verified here if you heard it yourself.</li>
          <li>While waiting, your child can keep learning as a guest. Guest learning doesn't count toward their progress.</li>
          <li>Learned mishnayos come back for review after 1, 3, 7, 14, 30 and 60 days. A finished perek is reviewed as a whole.</li>
          <li>Hebrew text: Torat Emet via Sefaria. Meanings come in two views. <b>Steinsaltz</b> is quoted word for word from the Koren Noé / William Davidson translation (bold = translation, light = explanation). <b>Simple</b> is an AI simplification of Steinsaltz, checked against Bartenura (tr. R. Shraga Silverstein); a few masechtos without Steinsaltz (Eduyot, Pirkei Avot) have only Simple, from Bartenura. Tap ⓘ by any meaning to see its source. Please check anything that looks off. <LicensesLink /></li>
        </ul>
      </section>
      <AboutNote />
    </div>
  );
}
