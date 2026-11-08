import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "../shared/api";
import { api } from "./api/client";
import { MasechtaGate } from "./components/MasechtaGate";
import { LockedSheet, OfficialBody } from "./components/PerekGate";
import type { PerekTestApi } from "./components/PerekReady";
import { CATALOG, DEFAULT_MASECHTA_ID, perakimOf, prefetchMasechta, shapeOf } from "./data";
import { GuestApp, type GuestStart } from "./GuestApp";
import { kv } from "./kv";
import { chooseMasechta, lastMasechtaOf, masechtaTiles, otherDue, sederIdOf, sederTiles } from "./nav";
import { introSeen, liveTest, markCelebrated, markIntroSeen, wasCelebrated } from "./perekTest";
import {
  completeVerified, frontier, gatedDueReviews, gatedNextInPerek, gatedNextLearning, hasProgressIn, isKnown, isLocked, mp,
  needsVerifIntro, perekPhase, sessionReviews, type Task, type Verified,
} from "./progress";
import { Home } from "./screens/Home";
import { MasechtaList, SederList } from "./screens/Masechtos";
import { MishnahScreen } from "./screens/MishnahScreen";
import { PerekScreen } from "./screens/PerekScreen";
import { Profiles } from "./screens/Profiles";
import { Session } from "./screens/Session";
import { today } from "./srs";
import { requestPersist } from "./storage";
import { useAccount } from "./sync/useAccount";
import type { Profile } from "./types";
import { useNavigatorOnline } from "./useOnline";

type Screen =
  | { s: "profiles" }
  /** Guest: a fresh local-only learner, never part of the account; forgotten on leaving. `start`: open at this perek. */
  | { s: "guest"; start?: GuestStart }
  /** The seder list. `m`: the child's current masechta (outlined; Back returns to its list). */
  | { s: "sedarim"; id: string; m: string }
  /** The masechta list of one seder. `m`: the child's current masechta (outlined; Back returns to its map). */
  | { s: "masechtos"; id: string; m: string; seder: string }
  /** The perek map of masechta `m`. Every screen below runs inside the masechta gate of `m`. */
  | { s: "home"; id: string; m: string }
  /** `from: "perek"`: opened from the perek screen, so Back returns there. */
  | { s: "mishnah"; id: string; m: string; perek: number; mishnah: number; group?: number; from?: "perek" }
  /** A perek's build-up. `group`/`sel` restore the path shown and the selection when coming back from a session. */
  | { s: "perek"; id: string; m: string; perek: number; group?: number; sel?: string }
  /** `scopePerek`: started from the perek screen, so "keep going" stays inside that perek. */
  | { s: "session"; id: string; m: string; tasks: Task[]; continueLearning: boolean; back: Screen; scopePerek?: number };

interface Props {
  user: User;
  /** The session expired; sign in again (local data kept). */
  onSignInAgain: () => void;
  /** "Parent? Sign in as parent": the shell syncs first (with the given function, up to 3 s), then opens parent mode. */
  onParentSignIn: (syncNow: () => Promise<void>) => Promise<void>;
}

/** Online as far as this tab can tell: the browser says so and the last sync didn't fail for lack of a network. */
function useOnline(syncOffline: boolean): boolean {
  return useNavigatorOnline() && !syncOffline;
}

/** A verification younger than this is celebrated on Home when it arrives there (older ones are just shown as tested). */
const CELEBRATE_WITHIN_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The learning app for one signed-in account. The screens are the pre-account app, backed by useAccount.
 * Every schedule here goes through the parent-verification gate (docs/PARENT_VERIFICATION.md §8): perakim past the
 * first one a parent hasn't verified are locked, and a learned perek's next step is its email test.
 */
export function LearningApp({ user, onSignInAgain, onParentSignIn }: Props) {
  const account = useAccount(user);
  const { profiles, setProfiles, addEvent, status, store } = account;
  const [screen, setScreen] = useState<Screen>({ s: "profiles" });

  /** The locked sheet (a tapped locked perek), over Home or the perek screen. */
  const [lockedSheet, setLockedSheet] = useState<number | null>(null);
  /** Bumped when a celebrate-once or intro flag is written (kv is not reactive). */
  const [, setFlags] = useState(0);
  const [devEmail, setDevEmail] = useState(false);
  const online = useOnline(status.state === "offline");

  useEffect(() => requestPersist(), []);
  useEffect(() => { api.config().then((c) => setDevEmail(c.devEmail), () => undefined); }, []);

  // Each child's last masechta starts downloading now, so picking the child opens it at once (and offline later).
  const lastKey = profiles.map(lastMasechtaOf).join(",");
  useEffect(() => {
    for (const id of new Set(lastKey.split(",").filter(Boolean))) prefetchMasechta(id).catch(() => undefined);
  }, [lastKey]);

  const profile = "id" in screen ? profiles.find((p) => p.id === screen.id) : undefined;
  const setProfile = (p: Profile) => setProfiles((list) => list.map((x) => (x.id === p.id ? p : x)));

  // A verified perek whose build-up was only "ready" becomes complete locally, so its perek review starts. Every
  // masechta, since verifications of any of them can arrive.
  useEffect(() => {
    const complete = (p: Profile) => CATALOG.reduce((q, e) => completeVerified(q, shapeOf(e.id), account.verifiedFor(p.id, e.id)), p);
    if (profiles.some((p) => complete(p) !== p)) setProfiles((list) => list.map(complete));
  }, [profiles, store.verified]); // eslint-disable-line react-hooks/exhaustive-deps

  // Polling from the waiting screen needs a stable function.
  const syncRef = useRef(account.syncNow);
  syncRef.current = account.syncNow;
  const refresh = useCallback(() => { void syncRef.current(); }, []);

  useEffect(() => {
    document.documentElement.style.setProperty("--scale", String(profile?.settings.fontScale ?? 1));
  }, [profile?.settings.fontScale]);

  if (screen.s === "guest") {
    return <GuestApp onExit={() => setScreen({ s: "profiles" })} {...(screen.start ? { start: screen.start } : {})} />;
  }
  if (screen.s === "profiles" || !profile) {
    return (
      <Profiles
        profiles={profiles}
        status={status}
        loading={store.cursor === 0 && status.state === "syncing" && profiles.length === 0}
        onPick={(id) => {
          const p = profiles.find((x) => x.id === id);
          setScreen({ s: "home", id, m: p ? lastMasechtaOf(p) : DEFAULT_MASECHTA_ID });
        }}
        onGuest={() => setScreen({ s: "guest" })}
        onParentSignIn={() => onParentSignIn(account.syncNow)}
      />
    );
  }

  const childId = profile.id;
  const verifiedOf = (masechta: string): Verified => account.verifiedFor(childId, masechta);
  /** Open masechta `id`'s perek map, remembering it as the child's last masechta when that changes. */
  const openMasechta = (id: string) => {
    const next = chooseMasechta(profile, id);
    if (next !== profile) setProfile(next);
    setScreen({ s: "home", id: childId, m: id });
  };

  if (screen.s === "sedarim" || screen.s === "masechtos") {
    const cur = screen.m;
    if (screen.s === "sedarim") {
      return (
        <SederList
          profile={profile}
          tiles={sederTiles(profile, cur, today(), verifiedOf)}
          onPick={(seder) => setScreen({ s: "masechtos", id: childId, m: cur, seder })}
          onBack={() => setScreen({ s: "masechtos", id: childId, m: cur, seder: sederIdOf(cur) })}
        />
      );
    }
    return (
      <MasechtaList
        profile={profile}
        seder={screen.seder}
        tiles={masechtaTiles(profile, screen.seder, cur, today(), verifiedOf)}
        online={online}
        onPick={openMasechta}
        onBack={() => setScreen({ s: "home", id: childId, m: cur })}
        onSedarim={() => setScreen({ s: "sedarim", id: childId, m: cur })}
      />
    );
  }

  // The masechta screens: the perek map, a mishnah, a perek, a session. All of them read masechta `m`'s text, so they
  // render inside its gate (remounted when the masechta changes).
  const m = screen.m;
  const toList = () => setScreen({ s: "masechtos", id: childId, m, seder: sederIdOf(m) });
  return (
    <MasechtaGate key={m} id={m} onChooseOther={toList}>
      {masechtaScreen()}
    </MasechtaGate>
  );

  function masechtaScreen(): JSX.Element {
    if (!profile || !("m" in screen)) return <></>;
    const ms = shapeOf(m);
    const v = verifiedOf(m);
    const f = frontier(ms, v);
    const home: Screen = { s: "home", id: childId, m };
    const sent = (perek: number): boolean => liveTest(account.lastTest(childId), m, perek, account.serverNow()) !== null;
    /** Today's session in this masechta: due reviews (gated, at most 6, oldest first), then the next learning (gated). */
    const startTasks = (): Task[] => {
      const next = gatedNextLearning(profile, ms, v);
      return [...sessionReviews(profile, gatedDueReviews(profile, ms, v)), ...(next ? [next] : [])].filter((t) => !isLocked(ms, v, t.perek));
    };
    const startSession = (tasks: Task[], back: Screen) =>
      setScreen({ s: "session", id: childId, m, tasks: tasks.filter((t) => !isLocked(ms, v, t.perek)), continueLearning: true, back });
    const openTest = (perek: number) => startSession([{ masechta: m, type: "perek-finish", perek }], home);
    const goFrontier = () => {
      setLockedSheet(null);
      if (f === null) return;
      if (perekPhase(profile, ms, v, f) === "test") openTest(f);
      else startSession(startTasks(), home);
    };
    const toGuest = (perek: number) => setScreen({ s: "guest", start: { masechta: m, perek } });
    const locked = lockedSheet !== null && f !== null && (
      <LockedSheet
        perek={lockedSheet}
        frontier={f}
        saved={hasProgressIn(profile, ms, lockedSheet)}
        testReady={perekPhase(profile, ms, v, f) === "test"}
        onGoFrontier={goFrontier}
        onGuest={() => { const perek = lockedSheet; setLockedSheet(null); toGuest(perek); }}
        onClose={() => setLockedSheet(null)}
      />
    );

    // Defense in depth: a locked perek's screens never open (a stale screen falls back to Home).
    if (screen.s === "home" || ((screen.s === "mishnah" || screen.s === "perek") && isLocked(ms, v, screen.perek))) {
      // "It's official!" when a parent's tap arrives while the child is on Home (once per verification per device).
      const fresh = [...v].filter((perek) => {
        const at = account.verifiedAt(childId, m, perek);
        return at !== null && !wasCelebrated(kv, childId, m, perek, at) && account.serverNow() - at < CELEBRATE_WITHIN_MS;
      });
      const celebrate = fresh.length ? Math.max(...fresh) : null;
      const doneCelebrating = () => {
        for (const perek of v) {
          const at = account.verifiedAt(childId, m, perek);
          if (at !== null) markCelebrated(kv, childId, m, perek, at);
        }
        setFlags((n) => n + 1);
      };
      // The one-time banner: gone once the frontier's test email is out, and marked seen as soon as the child starts
      // from Home any other way (the big button, a test row), so it never lingers.
      const intro = celebrate === null && f !== null && !sent(f) && needsVerifIntro(profile, ms, v) && !introSeen(kv, childId);
      const closeIntro = () => { markIntroSeen(kv, childId); setFlags((n) => n + 1); };
      const seenIntro = () => { if (intro) closeIntro(); };
      return (
        <>
          <Home
            profile={profile}
            onBack={() => setScreen({ s: "profiles" })}
            onFontScale={(fontScale) => setProfile({ ...profile, settings: { ...profile.settings, fontScale } })}
            onOpenMishnah={(perek, mishnah) => (isLocked(ms, v, perek) ? setLockedSheet(perek) : setScreen({ s: "mishnah", id: childId, m, perek, mishnah }))}
            onOpenPerek={(perek) => (isLocked(ms, v, perek) ? setLockedSheet(perek) : setScreen({ s: "perek", id: childId, m, perek }))}
            onStart={() => { seenIntro(); startSession(startTasks(), home); }}
            onChooseMasechta={toList}
            others={otherDue(profile, m, today(), verifiedOf)}
            onOpenMasechta={openMasechta}
            gate={{
              verified: v,
              sent,
              onLocked: setLockedSheet,
              onOpenTest: (perek) => { seenIntro(); openTest(perek); },
              ...(intro && f !== null ? {
                intro: {
                  frontier: f,
                  testReady: perekPhase(profile, ms, v, f) === "test",
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
      const st = mp(profile, ms, perek, mishnah);
      const go = (t: Task) => setScreen({ s: "session", id: childId, m, tasks: [t], continueLearning: false, back: screen });
      return (
        <MishnahScreen
          profile={profile}
          perek={perek}
          mishnah={mishnah}
          onBack={() => setScreen(screen.from === "perek" ? { s: "perek", id: childId, m, perek } : home)}
          {...(screen.from === "perek" ? { backLabel: "‹ Perek" } : {})}
          onPractice={() => go({ masechta: m, type: "learn", perek, mishnah })}
          onView={(mv) => setProfile({ ...profile, settings: { ...profile.settings, meaningView: mv } })}
          onReview={() => go(isKnown(st) ? { masechta: m, type: "review-m", perek, mishnah } : { masechta: m, type: "learn", perek, mishnah })}
          onPracticeRange={({ from, to, label, group }) =>
            setScreen({ s: "session", id: childId, m, tasks: [{ masechta: m, type: "practice", perek, mishnah, from, to, label }], continueLearning: false, back: { ...screen, group } })}
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
            gate={{ phase: perekPhase(profile, ms, v, perek), sent: sent(perek), next: gatedNextInPerek(profile, ms, v, perek) }}
            onBack={() => setScreen(home)}
            onOpenMishnah={(mishnah) => setScreen({ s: "mishnah", id: childId, m, perek, mishnah, from: "perek" })}
            onStart={(task, ui) =>
              isLocked(ms, v, task.perek) ? setLockedSheet(task.perek)
                : setScreen({ s: "session", id: childId, m, tasks: [task], continueLearning: false, scopePerek: perek, back: { s: "perek", id: childId, m, perek, ...ui } })}
          />
          {locked}
        </>
      );
    }

    if (screen.s !== "session") return <></>;
    const scope = screen.scopePerek;
    const upNextOf = (p: Profile): Task | null => (scope !== undefined ? gatedNextInPerek(p, ms, v, scope) : gatedNextLearning(p, ms, v));
    const more = scope !== undefined || screen.continueLearning ? upNextOf : undefined;
    const perekTest: PerekTestApi = {
      verifiedAt: (perek) => account.verifiedAt(childId, m, perek),
      locked: (perek) => isLocked(ms, v, perek),
      lastTest: (perek) => liveTest(account.lastTest(childId), m, perek, account.serverNow()),
      serverNow: account.serverNow,
      request: (perek) => account.requestTest(childId, m, perek),
      refresh,
      online,
      devEmail,
      onGuest: (perek) => toGuest(perakimOf(ms).includes(perek) ? perek : f ?? 1),
      onSignInAgain,
    };
    return (
      <Session
        key={JSON.stringify(screen.tasks)}
        profile={profile}
        tasks={screen.tasks.filter((t) => t.masechta === m && !isLocked(ms, v, t.perek))}
        onProfile={setProfile}
        onEvent={(body) => addEvent(childId, body)}
        onExit={() => setScreen(screen.back)}
        onMap={() => setScreen(home)}
        {...(more ? { more } : {})}
        upNextOf={upNextOf}
        perekTest={perekTest}
      />
    );
  }
}
