import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "../shared/api";
import { api } from "./api/client";
import { LockedSheet, OfficialBody } from "./components/PerekGate";
import type { PerekTestApi } from "./components/PerekReady";
import { DEFAULT_MASECHTA_ID, PERAKIM } from "./data";
import { kv } from "./kv";
import { introSeen, liveTest, markCelebrated, markIntroSeen, wasCelebrated } from "./perekTest";
import {
  completeVerified, frontier, gatedDueReviews, gatedNextInPerek, gatedNextLearning, hasProgressIn, isKnown, isLocked, mp,
  needsVerifIntro, perekPhase, sessionReviews, type Task, type Verified,
} from "./progress";
import { Home } from "./screens/Home";
import { ImportPrompt } from "./screens/ImportPrompt";
import { MishnahScreen } from "./screens/MishnahScreen";
import { PerekScreen } from "./screens/PerekScreen";
import { Parent } from "./screens/Parent";
import { Profiles } from "./screens/Profiles";
import { GuestApp } from "./GuestApp";
import { Session } from "./screens/Session";
import { canImportDevice, normalizeProfile } from "./legacy/import";
import { loadLegacy, requestPersist } from "./storage";
import { useAccount } from "./sync/useAccount";
import type { Profile } from "./types";

type Screen =
  | { s: "profiles" }
  | { s: "parent" }
  /** Guest: a fresh local-only learner, never part of the account; forgotten on leaving. `start`: open at this perek. */
  | { s: "guest"; start?: { perek: number } }
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

/** Online as far as this tab can tell: the browser says so and the last sync didn't fail for lack of a network. */
function useOnline(syncOffline: boolean): boolean {
  const [nav, setNav] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setNav(true);
    const off = () => setNav(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  return nav && !syncOffline;
}

/** A verification younger than this is celebrated on Home when it arrives there (older ones are just shown as tested). */
const CELEBRATE_WITHIN_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The learning app for one signed-in account. The screens are the pre-account app, backed by useAccount.
 * Every schedule here goes through the parent-verification gate (docs/PARENT_VERIFICATION.md §8): perakim past the
 * first one a parent hasn't verified are locked, and a learned perek's next step is its email test.
 */
export function LearningApp({ user, onSignedOut, onSignInAgain }: Props) {
  const account = useAccount(user);
  const { profiles, setProfiles, addEvent, status, store } = account;
  const [screen, setScreen] = useState<Screen>({ s: "profiles" });
  const legacy = useMemo(() => loadLegacy().profiles.map(normalizeProfile), []);
  /** "Not now" in the import prompt: in memory only. Forced: reopened from the parent area. */
  const [importSnoozed, setImportSnoozed] = useState(false);
  const [importForced, setImportForced] = useState(false);

  /** The locked sheet (a tapped locked perek), over Home or the perek screen. */
  const [lockedSheet, setLockedSheet] = useState<number | null>(null);
  /** Bumped when a celebrate-once or intro flag is written (kv is not reactive). */
  const [, setFlags] = useState(0);
  const [devEmail, setDevEmail] = useState(false);
  const online = useOnline(status.state === "offline");

  useEffect(() => requestPersist(), []);
  useEffect(() => { api.config().then((c) => setDevEmail(c.devEmail), () => undefined); }, []);

  const profile = "id" in screen ? profiles.find((p) => p.id === screen.id) : undefined;
  const setProfile = (p: Profile) => setProfiles((list) => list.map((x) => (x.id === p.id ? p : x)));

  // Server-owned verified perakim per child (never part of Profile).
  const verifiedById = useMemo(() => new Map(profiles.map((p) => [p.id, account.verifiedFor(p.id)] as const)), [profiles, store.verified]); // eslint-disable-line react-hooks/exhaustive-deps
  const verifiedOf = (id: string): Verified => verifiedById.get(id) ?? account.verifiedFor(id);

  // A verified perek whose build-up was only "ready" becomes complete locally, so its perek review starts.
  useEffect(() => {
    if (profiles.some((p) => completeVerified(p, verifiedOf(p.id)) !== p)) {
      setProfiles((list) => list.map((p) => completeVerified(p, verifiedOf(p.id))));
    }
  }, [verifiedById]); // eslint-disable-line react-hooks/exhaustive-deps

  // Polling from the waiting screen needs a stable function.
  const syncRef = useRef(account.syncNow);
  syncRef.current = account.syncNow;
  const refresh = useCallback(() => { void syncRef.current(); }, []);

  useEffect(() => {
    document.documentElement.style.setProperty("--scale", String(profile?.settings.fontScale ?? 1));
  }, [profile?.settings.fontScale]);

  const canImport = canImportDevice(legacy.length, profiles.length, store.lastSyncAt);

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
        hasLegacy={canImport}
        verifiedOf={verifiedOf}
        verifiedAtOf={account.verifiedAt}
        lastTestOf={account.lastTest}
        serverNow={account.serverNow}
        onReopenImport={() => { setImportForced(true); setScreen({ s: "profiles" }); }}
        onBack={() => setScreen({ s: "profiles" })}
      />
    );
  }
  if (screen.s === "guest") {
    return <GuestApp onExit={() => setScreen({ s: "profiles" })} {...(screen.start ? { start: screen.start } : {})} />;
  }
  if (screen.s === "profiles" || !profile) {
    const showImport = canImport && (importForced || (store.importDecision === "none" && !importSnoozed));
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

  const v = verifiedOf(profile.id);
  const f = frontier(v);
  const childId = profile.id;
  const sent = (perek: number): boolean => liveTest(account.lastTest(childId), DEFAULT_MASECHTA_ID, perek, account.serverNow()) !== null;
  /** Today's session: due reviews (gated, at most 6, oldest first), then the next learning (gated). */
  const startTasks = (): Task[] => {
    const next = gatedNextLearning(profile, v);
    return [...sessionReviews(profile, gatedDueReviews(profile, v)), ...(next ? [next] : [])].filter((t) => !isLocked(v, t.perek));
  };
  const startSession = (tasks: Task[], back: Screen) =>
    setScreen({ s: "session", id: childId, tasks: tasks.filter((t) => !isLocked(v, t.perek)), continueLearning: true, back });
  const openTest = (perek: number) => startSession([{ type: "perek-finish", perek }], { s: "home", id: childId });
  const goFrontier = () => {
    setLockedSheet(null);
    if (f === null) return;
    if (perekPhase(profile, v, f) === "test") openTest(f);
    else startSession(startTasks(), { s: "home", id: childId });
  };
  const locked = lockedSheet !== null && f !== null && (
    <LockedSheet
      perek={lockedSheet}
      frontier={f}
      saved={hasProgressIn(profile, lockedSheet)}
      testReady={perekPhase(profile, v, f) === "test"}
      onGoFrontier={goFrontier}
      onGuest={() => { const perek = lockedSheet; setLockedSheet(null); setScreen({ s: "guest", start: { perek } }); }}
      onClose={() => setLockedSheet(null)}
    />
  );

  // Defense in depth: a locked perek's screens never open (a stale screen falls back to Home).
  if (screen.s === "home" || ((screen.s === "mishnah" || screen.s === "perek") && isLocked(v, screen.perek))) {
    const home: Screen = { s: "home", id: childId };
    // "It's official!" when a parent's tap arrives while the child is on Home (once per verification per device).
    const fresh = [...v].filter((perek) => {
      const at = account.verifiedAt(childId, perek);
      return at !== null && !wasCelebrated(kv, childId, DEFAULT_MASECHTA_ID, perek, at) && account.serverNow() - at < CELEBRATE_WITHIN_MS;
    });
    const celebrate = fresh.length ? Math.max(...fresh) : null;
    const doneCelebrating = () => {
      for (const perek of v) {
        const at = account.verifiedAt(childId, perek);
        if (at !== null) markCelebrated(kv, childId, DEFAULT_MASECHTA_ID, perek, at);
      }
      setFlags((n) => n + 1);
    };
    const intro = celebrate === null && f !== null && needsVerifIntro(profile, v) && !introSeen(kv, childId);
    const closeIntro = () => { markIntroSeen(kv, childId); setFlags((n) => n + 1); };
    return (
      <>
        <Home
          profile={profile}
          onBack={() => setScreen({ s: "profiles" })}
          onOpenMishnah={(perek, mishnah) => (isLocked(v, perek) ? setLockedSheet(perek) : setScreen({ s: "mishnah", id: childId, perek, mishnah }))}
          onOpenPerek={(perek) => (isLocked(v, perek) ? setLockedSheet(perek) : setScreen({ s: "perek", id: childId, perek }))}
          onStart={() => startSession(startTasks(), home)}
          gate={{
            verified: v,
            sent,
            onLocked: setLockedSheet,
            onOpenTest: openTest,
            ...(intro && f !== null ? {
              intro: {
                frontier: f,
                onGo: () => { closeIntro(); goFrontier(); },
                onClose: closeIntro,
              },
            } : {}),
          }}
        />
        {locked}
        {celebrate !== null && (
          <div className="sheet-backdrop" role="dialog" aria-modal="true" onClick={doneCelebrating}>
            <div className="sheet" onClick={(e) => e.stopPropagation()}>
              <OfficialBody
                name={profile.name}
                perek={celebrate}
                onNext={() => { doneCelebrating(); startSession(startTasks(), home); }}
                onMap={doneCelebrating}
              />
            </div>
          </div>
        )}
      </>
    );
  }

  if (screen.s === "mishnah") {
    const { perek, mishnah } = screen;
    const st = mp(profile, perek, mishnah);
    const go = (t: Task) => setScreen({ s: "session", id: childId, tasks: [t], continueLearning: false, back: screen });
    return (
      <MishnahScreen
        profile={profile}
        perek={perek}
        mishnah={mishnah}
        onBack={() => setScreen(screen.from === "perek" ? { s: "perek", id: childId, perek } : { s: "home", id: childId })}
        {...(screen.from === "perek" ? { backLabel: "‹ Perek" } : {})}
        onPractice={() => go({ type: "learn", perek, mishnah })}
        onView={(v) => setProfile({ ...profile, settings: { ...profile.settings, meaningView: v } })}
        onReview={() => (isKnown(st) ? go({ type: "review-m", perek, mishnah }) : go({ type: "learn", perek, mishnah }))}
        onPracticeRange={({ from, to, label, group }) =>
          setScreen({ s: "session", id: childId, tasks: [{ type: "practice", perek, mishnah, from, to, label }], continueLearning: false, back: { ...screen, group } })}
        {...(screen.group !== undefined ? { group: screen.group } : {})}
      />
    );
  }

  if (screen.s === "perek") {
    const { perek } = screen;
    return (
      <>
        <PerekScreen
          key={perek}
          profile={profile}
          perek={perek}
          group={screen.group}
          sel={screen.sel}
          gate={{ phase: perekPhase(profile, v, perek), sent: sent(perek), next: gatedNextInPerek(profile, v, perek) }}
          onBack={() => setScreen({ s: "home", id: childId })}
          onOpenMishnah={(mishnah) => setScreen({ s: "mishnah", id: childId, perek, mishnah, from: "perek" })}
          onStart={(task, ui) =>
            isLocked(v, task.perek) ? setLockedSheet(task.perek)
              : setScreen({ s: "session", id: childId, tasks: [task], continueLearning: false, scopePerek: perek, back: { s: "perek", id: childId, perek, ...ui } })}
        />
        {locked}
      </>
    );
  }

  const scope = screen.scopePerek;
  const upNextOf = (p: Profile): Task | null => (scope !== undefined ? gatedNextInPerek(p, v, scope) : gatedNextLearning(p, v));
  const more = scope !== undefined || screen.continueLearning ? upNextOf : undefined;
  const perekTest: PerekTestApi = {
    verifiedAt: (perek) => account.verifiedAt(childId, perek),
    locked: (perek) => isLocked(v, perek),
    lastTest: (perek) => liveTest(account.lastTest(childId), DEFAULT_MASECHTA_ID, perek, account.serverNow()),
    serverNow: account.serverNow,
    request: (perek) => account.requestTest(childId, perek),
    refresh,
    online,
    devEmail,
    onGuest: (perek) => setScreen({ s: "guest", start: { perek: PERAKIM.includes(perek) ? perek : f ?? 1 } }),
    onParentArea: () => setScreen({ s: "parent" }),
  };
  return (
    <Session
      key={JSON.stringify(screen.tasks)}
      profile={profile}
      tasks={screen.tasks.filter((t) => !isLocked(v, t.perek))}
      onProfile={setProfile}
      onEvent={(body) => addEvent(childId, body)}
      onExit={() => setScreen(screen.back)}
      onMap={() => setScreen({ s: "home", id: childId })}
      {...(more ? { more } : {})}
      upNextOf={upNextOf}
      perekTest={perekTest}
    />
  );
}
