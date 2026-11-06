import { useEffect, useMemo, useState } from "react";
import type { User } from "../shared/api";
import { dueReviews, isKnown, mp, nextInPerek, nextLearning, type Task } from "./progress";
import { Home } from "./screens/Home";
import { ImportPrompt } from "./screens/ImportPrompt";
import { MishnahScreen } from "./screens/MishnahScreen";
import { PerekScreen } from "./screens/PerekScreen";
import { Parent } from "./screens/Parent";
import { Profiles } from "./screens/Profiles";
import { GuestApp } from "./GuestApp";
import { Session } from "./screens/Session";
import { normalizeProfile } from "./legacy/import";
import { loadLegacy, requestPersist } from "./storage";
import { useAccount } from "./sync/useAccount";
import type { Profile } from "./types";

type Screen =
  | { s: "profiles" }
  | { s: "parent" }
  /** Guest: a fresh local-only learner, never part of the account; forgotten on leaving. */
  | { s: "guest" }
  | { s: "home"; id: string }
  /** `from: "perek"`: opened from the perek screen, so Back returns there. */
  | { s: "mishnah"; id: string; perek: number; mishnah: number; group?: number; from?: "perek" }
  /** A perek's build-up. `group`/`sel` restore the path shown and the selection when coming back from a session. */
  | { s: "perek"; id: string; perek: number; group?: number; sel?: string }
  /** `scopePerek`: started from the perek screen, so "keep going" stays inside that perek. */
  | { s: "session"; id: string; tasks: Task[]; continueLearning: boolean; back: Screen; scopePerek?: number };

interface Props {
  user: User;
  /** Local account data is gone; show Login. */
  onSignedOut: () => void;
  /** The session expired; sign in again (local data kept). */
  onSignInAgain: () => void;
}

/** The learning app for one signed-in account. The screens are the pre-account app, backed by useAccount. */
export function LearningApp({ user, onSignedOut, onSignInAgain }: Props) {
  const account = useAccount(user);
  const { profiles, setProfiles, addEvent, status, store } = account;
  const [screen, setScreen] = useState<Screen>({ s: "profiles" });
  const legacy = useMemo(() => loadLegacy().profiles.map(normalizeProfile), []);
  /** "Not now" in the import prompt: in memory only. Forced: reopened from the parent area. */
  const [importSnoozed, setImportSnoozed] = useState(false);
  const [importForced, setImportForced] = useState(false);

  useEffect(() => requestPersist(), []);

  const profile = "id" in screen ? profiles.find((p) => p.id === screen.id) : undefined;
  const setProfile = (p: Profile) => setProfiles((list) => list.map((x) => (x.id === p.id ? p : x)));

  useEffect(() => {
    document.documentElement.style.setProperty("--scale", String(profile?.settings.fontScale ?? 1));
  }, [profile?.settings.fontScale]);

  if (screen.s === "parent") {
    return (
      <Parent
        user={user}
        profiles={profiles}
        setProfiles={setProfiles}
        onEvent={addEvent}
        status={status}
        syncNow={account.syncNow}
        pendingNow={account.pendingNow}
        endSession={account.endSession}
        onSignOut={onSignedOut}
        onSignInAgain={onSignInAgain}
        hasLegacy={legacy.length > 0}
        onReopenImport={() => { setImportForced(true); setScreen({ s: "profiles" }); }}
        onBack={() => setScreen({ s: "profiles" })}
      />
    );
  }
  if (screen.s === "guest") {
    return <GuestApp onExit={() => setScreen({ s: "profiles" })} />;
  }
  if (screen.s === "profiles" || !profile) {
    const showImport = legacy.length > 0 && (importForced || (store.importDecision === "none" && !importSnoozed));
    return (
      <>
        <Profiles
          profiles={profiles}
          status={status}
          loading={store.cursor === 0 && status.state === "syncing" && profiles.length === 0}
          onAdd={(p) => setProfiles((list) => [...list, p])}
          onPick={(id) => setScreen({ s: "home", id })}
          onGuest={() => setScreen({ s: "guest" })}
          onParent={() => setScreen({ s: "parent" })}
        />
        {showImport && (
          <ImportPrompt
            legacy={legacy}
            existing={profiles}
            onImport={(selected) => { account.importLegacy(selected); setImportForced(false); }}
            onLater={() => { setImportSnoozed(true); setImportForced(false); }}
            onNever={() => { account.setImportDecision("dismissed"); setImportForced(false); }}
          />
        )}
      </>
    );
  }

  if (screen.s === "home") {
    return (
      <Home
        profile={profile}
        onBack={() => setScreen({ s: "profiles" })}
        onOpenMishnah={(perek, mishnah) => setScreen({ s: "mishnah", id: profile.id, perek, mishnah })}
        onOpenPerek={(perek) => setScreen({ s: "perek", id: profile.id, perek })}
        onStart={() => {
          const next = nextLearning(profile);
          const tasks = [...dueReviews(profile), ...(next ? [next] : [])];
          setScreen({ s: "session", id: profile.id, tasks, continueLearning: true, back: screen });
        }}
      />
    );
  }

  if (screen.s === "mishnah") {
    const { perek, mishnah } = screen;
    const st = mp(profile, perek, mishnah);
    const go = (t: Task) => setScreen({ s: "session", id: profile.id, tasks: [t], continueLearning: false, back: screen });
    return (
      <MishnahScreen
        profile={profile}
        perek={perek}
        mishnah={mishnah}
        onBack={() => setScreen(screen.from === "perek" ? { s: "perek", id: profile.id, perek } : { s: "home", id: profile.id })}
        {...(screen.from === "perek" ? { backLabel: "‹ Perek" } : {})}
        onPractice={() => go({ type: "learn", perek, mishnah })}
        onView={(v) => setProfile({ ...profile, settings: { ...profile.settings, meaningView: v } })}
        onReview={() => (isKnown(st) ? go({ type: "review-m", perek, mishnah }) : go({ type: "learn", perek, mishnah }))}
        onPracticeRange={({ from, to, label, group }) =>
          setScreen({ s: "session", id: profile.id, tasks: [{ type: "practice", perek, mishnah, from, to, label }], continueLearning: false, back: { ...screen, group } })}
        {...(screen.group !== undefined ? { group: screen.group } : {})}
      />
    );
  }

  if (screen.s === "perek") {
    const { perek } = screen;
    return (
      <PerekScreen
        key={perek}
        profile={profile}
        perek={perek}
        group={screen.group}
        sel={screen.sel}
        onBack={() => setScreen({ s: "home", id: profile.id })}
        onOpenMishnah={(mishnah) => setScreen({ s: "mishnah", id: profile.id, perek, mishnah, from: "perek" })}
        onStart={(task, ui) =>
          setScreen({ s: "session", id: profile.id, tasks: [task], continueLearning: false, scopePerek: perek, back: { s: "perek", id: profile.id, perek, ...ui } })}
      />
    );
  }

  const scope = screen.scopePerek;
  const more = scope !== undefined ? (p: Profile) => nextInPerek(p, scope) : screen.continueLearning ? nextLearning : undefined;
  return (
    <Session
      key={JSON.stringify(screen.tasks)}
      profile={profile}
      tasks={screen.tasks}
      onProfile={setProfile}
      onEvent={(body) => addEvent(profile.id, body)}
      onExit={() => setScreen(screen.back)}
      onMap={() => setScreen({ s: "home", id: profile.id })}
      {...(more ? { more } : {})}
      {...(scope !== undefined ? { upNextOf: (p: Profile) => nextInPerek(p, scope) } : {})}
    />
  );
}
