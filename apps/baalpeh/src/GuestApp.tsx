import { useEffect, useState } from "react";
import { loadGuest, saveGuest, sessionGuest } from "./guest";
import { kv } from "./kv";
import { dueReviews, isKnown, mp, nextInPerek, nextLearning, type Task } from "./progress";
import { BreakSetting } from "./components/BreakSetting";
import { AboutNote, LicensesLink, PricingNote } from "./components/Licenses";
import { Home } from "./screens/Home";
import { MishnahScreen } from "./screens/MishnahScreen";
import { PerekScreen } from "./screens/PerekScreen";
import { Session } from "./screens/Session";
import { requestPersist } from "./storage";
import type { Profile } from "./types";

export type Screen =
  | { s: "home" }
  | { s: "settings" }
  /** `from: "perek"`: opened from the perek screen, so Back returns there. */
  | { s: "mishnah"; perek: number; mishnah: number; group?: number; from?: "perek" }
  /** A perek's build-up. `group`/`sel` restore the path shown and the selection when coming back from a session. */
  | { s: "perek"; perek: number; group?: number; sel?: string }
  /** `scopePerek`: started from the perek screen, so "keep going" stays inside that perek. */
  | { s: "session"; tasks: Task[]; continueLearning: boolean; back: Screen; scopePerek?: number };

/**
 * Where guest mode was opened from, which decides what it keeps:
 * - signed out (`onSignIn`): one guest learner saved in this browser (v1 format), offered for import after sign-in;
 * - the signed-in picker (`onExit`): a fresh guest held in memory only; nothing is saved, and leaving forgets it.
 */
type Props =
  | { /** Leave guest mode for the sign-in screen. The guest's progress stays on this device. */ onSignIn: () => void; onExit?: never; start?: never }
  | {
    /** Back to "Who's learning?". The guest's progress is dropped. */ onExit: () => void; onSignIn?: never;
    /**
     * "Continue as a guest" from a locked perek or the waiting screen (docs/PARENT_VERIFICATION.md §9): open straight
     * at this perek's first mishnah (or `mishnah`), with "keep going" staying inside that perek.
     */
    start?: { perek: number; mishnah?: number } | undefined;
  };

/** The first screen: Home, or a session at `start` (its Back goes to that perek's screen). */
export function guestStartScreen(start: { perek: number; mishnah?: number } | undefined): Screen {
  if (!start) return { s: "home" };
  return {
    s: "session", tasks: [{ type: "learn", perek: start.perek, mishnah: start.mishnah ?? 1 }], continueLearning: false,
    scopePerek: start.perek, back: { s: "perek", perek: start.perek },
  };
}

/**
 * The learning app with no account: one implicit "Guest" learner. Ungated: no parent test, and nothing here ever
 * counts toward a child's progress (a signed-out guest's saved progress reaches an account only by import, unverified).
 * It never imports the API client, the sync engine or Turnstile, so it makes no server requests.
 */
export function GuestApp({ onSignIn, onExit, start }: Props) {
  const saved = onSignIn !== undefined;
  const [profile, setProfileState] = useState<Profile>(() => (saved ? loadGuest(kv) : sessionGuest()));
  const [screen, setScreen] = useState<Screen>(() => guestStartScreen(start));
  const [info, setInfo] = useState(false);

  useEffect(() => { if (saved) requestPersist(); }, [saved]);
  useEffect(() => {
    document.documentElement.style.setProperty("--scale", String(profile.settings.fontScale));
  }, [profile.settings.fontScale]);
  // Don't leave the guest's text size on the picker (or the sign-in screen) after leaving.
  useEffect(() => () => document.documentElement.style.setProperty("--scale", "1"), []);

  const setProfile = (p: Profile) => {
    setProfileState(p);
    if (saved) saveGuest(kv, p);
  };

  const pill = <GuestPill saved={saved} onOpen={() => setInfo(true)} />;
  const sheet = info && (
    <GuestInfo
      {...(onSignIn ? { onSignIn } : { onExit })}
      onSettings={() => { setInfo(false); setScreen({ s: "settings" }); }}
      onClose={() => setInfo(false)}
    />
  );

  let body: React.ReactNode;
  if (screen.s === "settings") {
    body = <GuestSettings profile={profile} onChange={setProfile} onBack={() => setScreen({ s: "home" })} {...(onSignIn ? { onSignIn } : {})} />;
  } else if (screen.s === "home") {
    body = (
      <Home
        profile={profile}
        {...(onExit ? { onBack: onExit } : {})}
        onOpenMishnah={(perek, mishnah) => setScreen({ s: "mishnah", perek, mishnah })}
        onOpenPerek={(perek) => setScreen({ s: "perek", perek })}
        onStart={() => {
          const next = nextLearning(profile);
          const tasks = [...dueReviews(profile), ...(next ? [next] : [])];
          setScreen({ s: "session", tasks, continueLearning: true, back: screen });
        }}
      />
    );
  } else if (screen.s === "mishnah") {
    const { perek, mishnah } = screen;
    const st = mp(profile, perek, mishnah);
    const go = (t: Task) => setScreen({ s: "session", tasks: [t], continueLearning: false, back: screen });
    body = (
      <MishnahScreen
        profile={profile}
        perek={perek}
        mishnah={mishnah}
        onBack={() => setScreen(screen.from === "perek" ? { s: "perek", perek } : { s: "home" })}
        {...(screen.from === "perek" ? { backLabel: "‹ Perek" } : {})}
        onPractice={() => go({ type: "learn", perek, mishnah })}
        onView={(v) => setProfile({ ...profile, settings: { ...profile.settings, meaningView: v } })}
        onReview={() => (isKnown(st) ? go({ type: "review-m", perek, mishnah }) : go({ type: "learn", perek, mishnah }))}
        onPracticeRange={({ from, to, label, group }) =>
          setScreen({ s: "session", tasks: [{ type: "practice", perek, mishnah, from, to, label }], continueLearning: false, back: { ...screen, group } })}
        {...(screen.group !== undefined ? { group: screen.group } : {})}
      />
    );
  } else if (screen.s === "perek") {
    const { perek } = screen;
    body = (
      <PerekScreen
        key={perek}
        profile={profile}
        perek={perek}
        group={screen.group}
        sel={screen.sel}
        onBack={() => setScreen({ s: "home" })}
        onOpenMishnah={(mishnah) => setScreen({ s: "mishnah", perek, mishnah, from: "perek" })}
        onStart={(task, ui) =>
          setScreen({ s: "session", tasks: [task], continueLearning: false, scopePerek: perek, back: { s: "perek", perek, ...ui } })}
      />
    );
  } else {
    const scope = screen.scopePerek;
    const more = scope !== undefined ? (p: Profile) => nextInPerek(p, scope) : screen.continueLearning ? nextLearning : undefined;
    body = (
      <Session
        key={JSON.stringify(screen.tasks)}
        profile={profile}
        tasks={screen.tasks}
        onProfile={setProfile}
        onExit={() => setScreen(screen.back)}
        onMap={() => setScreen({ s: "home" })}
        {...(more ? { more } : {})}
        {...(scope !== undefined ? { upNextOf: (p: Profile) => nextInPerek(p, scope) } : {})}
      />
    );
  }

  return <>{pill}{body}{sheet}</>;
}

function GuestPill({ saved, onOpen }: { saved: boolean; onOpen: () => void }) {
  return (
    <div className="guest-bar" dir="ltr">
      <button className="guest-pill" onClick={onOpen} aria-haspopup="dialog">
        {saved ? "Guest · progress saved only in this browser" : "Guest · nothing is saved"}
      </button>
    </div>
  );
}

function GuestInfo({ onSignIn, onExit, onSettings, onClose }: {
  onSignIn?: () => void; onExit?: () => void; onSettings: () => void; onClose: () => void;
}) {
  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-labelledby="guest-title" onClick={onClose}>
      <div className="sheet guest-sheet" dir="ltr" onClick={(e) => e.stopPropagation()}>
        <h3 id="guest-title">You're learning as a guest</h3>
        {onSignIn ? (
          <>
            <p>Your progress is saved only in this browser on this device. It isn't backed up, and it won't show up in other browsers or on other devices. Clearing this browser's data erases it.</p>
            <p className="hint">If you sign in on this device later, you can add this progress to your account.</p>
            <button className="btn primary" onClick={onSignIn}>Create an account / Sign in</button>
            <PricingNote />
          </>
        ) : (
          <>
            <p>Nothing you learn as a guest is saved or added to your account. When you switch back, the guest is forgotten, and next time Guest starts fresh.</p>
            {onExit && <button className="btn primary" onClick={onExit}>‹ Back to Who's learning?</button>}
          </>
        )}
        <div className="row center">
          <button className="btn ghost-btn small" onClick={onSettings}>⚙ Settings</button>
          <button className="btn ghost-btn small" onClick={onClose}>Keep learning</button>
        </div>
      </div>
    </div>
  );
}

/** The parent area's per-child settings, for the one guest learner. Nothing about accounts. */
function GuestSettings({ profile: p, onChange, onBack, onSignIn }: {
  profile: Profile; onChange: (p: Profile) => void; onBack: () => void; onSignIn?: () => void;
}) {
  const set = <K extends keyof Profile["settings"]>(k: K, v: Profile["settings"][K]) => onChange({ ...p, settings: { ...p.settings, [k]: v } });
  return (
    <div className="parent" dir="ltr">
      <div className="topbar">
        <button className="btn ghost-btn small" onClick={onBack}>‹ Back</button>
        <span className="who">Settings on this device</span>
      </div>
      <section>
        <div className="child-settings">
          <label>Text size <input type="range" min={0.8} max={1.6} step={0.1} value={p.settings.fontScale} onChange={(e) => set("fontScale", Number(e.target.value))} /></label>
          <BreakSetting p={p} onChange={onChange} />
          <label>Meanings while learning
            <select value={p.settings.meaningView ?? "simple"} onChange={(e) => set("meaningView", e.target.value === "steinsaltz" ? "steinsaltz" : "simple")}>
              <option value="simple">Simple (for young readers)</option>
              <option value="steinsaltz">Steinsaltz (bold translation + explanation)</option>
            </select>
          </label>
        </div>
      </section>
      <section>
        <h3>Guest mode</h3>
        {onSignIn ? (
          <>
            <p className="hint">Progress is saved only in this browser on this device. Nothing is backed up or shared, and clearing this browser's data erases it.
              After you sign in on this device, you can add it to your account.</p>
            <button className="btn secondary" onClick={onSignIn}>Create an account / Sign in</button>
            <PricingNote />
          </>
        ) : (
          <p className="hint">Nothing is saved for a guest, and it isn't added to your account. These settings last until you switch back.</p>
        )}
      </section>
      <section>
        <h3>Sources</h3>
        <p className="hint">Hebrew text: Torat Emet via Sefaria. Meanings are based on Steinsaltz (Koren Noé / William Davidson Edition) and Bartenura (tr. R. Shraga Silverstein).</p>
        <LicensesLink />
      </section>
      <AboutNote />
    </div>
  );
}
