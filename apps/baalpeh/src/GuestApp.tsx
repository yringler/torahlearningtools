import { useEffect, useState } from "react";
import { loadGuest, saveGuest } from "./guest";
import { kv } from "./kv";
import { dueReviews, isKnown, mp, nextLearning, type Task } from "./progress";
import { Home } from "./screens/Home";
import { MishnahScreen } from "./screens/MishnahScreen";
import { Session } from "./screens/Session";
import { requestPersist } from "./storage";
import type { Profile } from "./types";

type Screen =
  | { s: "home" }
  | { s: "settings" }
  | { s: "mishnah"; perek: number; mishnah: number }
  | { s: "session"; tasks: Task[]; continueLearning: boolean; back: Screen };

interface Props {
  /** Leave guest mode for the sign-in screen. The guest's progress stays on this device. */
  onSignIn: () => void;
}

/**
 * The learning app with no account: one implicit "Guest" learner saved only in this browser.
 * It never imports the API client, the sync engine or Turnstile, so it makes no server requests.
 */
export function GuestApp({ onSignIn }: Props) {
  const [profile, setProfileState] = useState<Profile>(() => loadGuest(kv));
  const [screen, setScreen] = useState<Screen>({ s: "home" });
  const [info, setInfo] = useState(false);

  useEffect(() => requestPersist(), []);
  useEffect(() => {
    document.documentElement.style.setProperty("--scale", String(profile.settings.fontScale));
  }, [profile.settings.fontScale]);

  const setProfile = (p: Profile) => {
    setProfileState(p);
    saveGuest(kv, p);
  };

  const pill = <GuestPill onOpen={() => setInfo(true)} />;
  const sheet = info && (
    <GuestInfo
      onSignIn={onSignIn}
      onSettings={() => { setInfo(false); setScreen({ s: "settings" }); }}
      onClose={() => setInfo(false)}
    />
  );

  let body: React.ReactNode;
  if (screen.s === "settings") {
    body = <GuestSettings profile={profile} onChange={setProfile} onBack={() => setScreen({ s: "home" })} onSignIn={onSignIn} />;
  } else if (screen.s === "home") {
    body = (
      <Home
        profile={profile}
        onOpenMishnah={(perek, mishnah) => setScreen({ s: "mishnah", perek, mishnah })}
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
        onBack={() => setScreen({ s: "home" })}
        onPractice={() => go({ type: "learn", perek, mishnah })}
        onView={(v) => setProfile({ ...profile, settings: { ...profile.settings, meaningView: v } })}
        onReview={() => (isKnown(st) ? go({ type: "review-m", perek, mishnah }) : go({ type: "learn", perek, mishnah }))}
      />
    );
  } else {
    body = (
      <Session
        key={JSON.stringify(screen.tasks)}
        profile={profile}
        tasks={screen.tasks}
        onProfile={setProfile}
        onExit={() => setScreen(screen.back)}
        {...(screen.continueLearning ? { more: nextLearning } : {})}
      />
    );
  }

  return <>{pill}{body}{sheet}</>;
}

function GuestPill({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="guest-bar" dir="ltr">
      <button className="guest-pill" onClick={onOpen} aria-haspopup="dialog">
        Guest · progress saved only on this device
      </button>
    </div>
  );
}

function GuestInfo({ onSignIn, onSettings, onClose }: { onSignIn: () => void; onSettings: () => void; onClose: () => void }) {
  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-labelledby="guest-title" onClick={onClose}>
      <div className="sheet guest-sheet" dir="ltr" onClick={(e) => e.stopPropagation()}>
        <h3 id="guest-title">You're learning as a guest</h3>
        <p>Your progress is saved only in this browser on this device. It isn't backed up, and it won't show up on other devices.</p>
        <p className="hint">If you sign in on this device later, you can add this progress to your account.</p>
        <button className="btn primary" onClick={onSignIn}>Create an account / Sign in</button>
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
  profile: Profile; onChange: (p: Profile) => void; onBack: () => void; onSignIn: () => void;
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
          <label>Session minutes <input type="number" min={5} max={60} value={p.settings.dailyMinutes} onChange={(e) => set("dailyMinutes", Number(e.target.value) || 15)} /></label>
          <label>Meanings while learning
            <select value={p.settings.meaningView ?? "simple"} onChange={(e) => set("meaningView", e.target.value === "steinsaltz" ? "steinsaltz" : "simple")}>
              <option value="simple">Simple (for young readers)</option>
              <option value="steinsaltz">Steinsaltz (bold translation + explanation)</option>
            </select>
          </label>
          <label><input type="checkbox" checked={p.settings.tts} onChange={(e) => set("tts", e.target.checked)} /> 🔊 Read-aloud (approximate: Israeli pronunciation, may skip nikud)</label>
        </div>
      </section>
      <section>
        <h3>Guest mode</h3>
        <p className="hint">Progress is saved only in this browser on this device. Nothing is backed up or shared between devices.
          After you sign in on this device, you can add it to your account.</p>
        <button className="btn secondary" onClick={onSignIn}>Create an account / Sign in</button>
      </section>
    </div>
  );
}
