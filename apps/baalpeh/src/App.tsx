import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { AuthSuccessResponse, ParentMeResponse, SignInAs, User } from "../shared/api";
import { api, ApiFailure } from "./api/client";
import { bootPhase, phaseAfterSignIn } from "./auth/boot";
import { CheckEmail } from "./auth/CheckEmail";
import { AuthFrame, Choose, GuestOption, LibraryOption, Login } from "./auth/Login";
import { PinResetLanding, takePinResetToken } from "./auth/PinResetLanding";
import { takeVerifyToken, VerifyLanding } from "./auth/VerifyLanding";
import { asksServer, bootRoute, isGuestChosen, setGuestChosen } from "./guest";
import { GuestApp } from "./GuestApp";
import { LicensesPage } from "./components/Licenses";
import { LICENSES_PATH } from "./sources";
import { PerekTestLanding, takePerekTestToken } from "./screens/PerekTestLanding";
import { kv } from "./kv";
import { LearningApp } from "./LearningApp";
import { isLibraryPath, LIBRARY_PATH, libraryPath, parseLibraryPath, type LibraryPlace } from "./library/location";
import { OpenLibraryContext } from "./library/open";
import { SEDARIM } from "./data";
import { ParentApp } from "./parent/ParentApp";
import { loadCurrentUser, setCurrentUser } from "./sync/store";

type Phase =
  | { phase: "boot" }
  /** `as` comes from the link fragment: display only (the server decides the scope). */
  | { phase: "verify"; token: string; as: SignInAs }
  | { phase: "choose"; reason?: "expired" }
  | { phase: "login"; as: SignInAs; reason?: "expired"; email?: string; lockEmail?: boolean }
  | { phase: "checkEmail"; as: SignInAs; email: string; lockEmail?: boolean }
  | { phase: "offlineNoAccount" }
  | { phase: "guest" }
  | { phase: "app"; user: User }
  /** Fetching GET /api/parent/me before the parent shell opens. */
  | { phase: "parentBoot"; learner: User | null }
  | { phase: "parent"; me: ParentMeResponse; learner: User | null };

// Read once per page load, before React renders (the fragment is stripped immediately).
const verify = typeof window === "undefined" ? null : takeVerifyToken();
// The parent's test link (/perek-test#t=…), read and stripped the same way.
const perekTestToken = typeof window === "undefined" ? null : takePerekTestToken();
// The "Forgot PIN?" email's link (/parent-pin#t=…).
const pinResetToken = typeof window === "undefined" ? null : takePinResetToken();

function initialPhase(): Phase {
  const cached = loadCurrentUser(kv);
  switch (bootRoute({ verifyToken: verify?.token ?? null, guest: isGuestChosen(kv), cachedUser: cached !== null })) {
    case "verify": return { phase: "verify", token: verify?.token ?? "", as: verify?.as ?? "learner" };
    case "guest": return { phase: "guest" };
    case "app": return cached ? { phase: "app", user: cached } : { phase: "boot" };
    case "boot": return { phase: "boot" };
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Routes by path: the public sources & licenses page, the parent's perek test page and the PIN reset page need no
 * sign-in (they never start the auth shell or sync); everything else goes through the auth shell.
 */
export function App() {
  if (perekTestToken !== null) return <PerekTestLanding token={perekTestToken} />;
  if (pinResetToken !== null) return <PinResetLanding token={pinResetToken} />;
  if (typeof window !== "undefined" && window.location.pathname.replace(/\/+$/, "") === LICENSES_PATH) return <LicensesPage />;
  return <WithLibrary />;
}

// The library is its own chunk: learners who never open it don't download it up front (the service worker still
// precaches it with the rest of the build, so it opens offline).
const LibraryApp = lazy(() => import("./library/LibraryApp"));

const placeFromUrl = (): LibraryPlace => parseLibraryPath(window.location.pathname, SEDARIM.map((s) => s.id));

/**
 * The library (docs/LIBRARY.md) over the auth shell. Opened from inside the app, it covers the shell, which stays
 * mounted (hidden) so a guest's in-memory progress and the learner app's state survive the visit; the library never
 * changes the active masechta those screens read. Opening pushes one history entry, so the browser's (or Android's)
 * Back leaves the library in one step. A /library link opened cold shows only the library: no sign-in check, no sync,
 * until "Done" brings up the shell.
 */
function WithLibrary() {
  const [lib, setLib] = useState<LibraryPlace | null>(() => (isLibraryPath(window.location.pathname) ? placeFromUrl() : null));
  const [shell, setShell] = useState(lib === null);
  /** Whether the open library sits on a history entry we pushed (so Done can go back instead of replacing). */
  const pushed = useRef(false);

  useEffect(() => {
    const onPop = () => {
      if (isLibraryPath(window.location.pathname)) { setLib(placeFromUrl()); return; }
      pushed.current = false;
      setLib(null);
      setShell(true);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const open = useCallback(() => {
    window.history.pushState({ library: true }, "", LIBRARY_PATH);
    pushed.current = true;
    setLib({ v: "home" });
  }, []);

  const done = () => {
    if (pushed.current) { window.history.back(); return; } // popstate closes it
    window.history.replaceState(null, "", "/");
    setLib(null);
    setShell(true);
  };

  return (
    <OpenLibraryContext.Provider value={open}>
      {shell && <div hidden={lib !== null}><AuthShell /></div>}
      {lib && (
        <Suspense fallback={<AuthFrame><p className="hint">Loading the library…</p></AuthFrame>}>
          <LibraryApp key={libraryPath(lib)} initial={lib} onDone={done} />
        </Suspense>
      )}
    </OpenLibraryContext.Provider>
  );
}

/** Auth shell: decides between the sign-in screens, the learning app and parent mode. */
function AuthShell() {
  const [phase, setPhase] = useState<Phase>(initialPhase);
  const [meTry, setMeTry] = useState(0);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  // Ask the server who is signed in: at boot without a cached user (blocking), and in the background with one.
  // Never in guest mode: a guest makes no server requests at all.
  useEffect(() => {
    if (!asksServer(phaseRef.current.phase)) return;
    let cancelled = false;
    api.me().then(
        ({ user }) => {
          if (cancelled) return;
          setCurrentUser(kv, user);
          setPhase((q) => (q.phase === "app" && q.user.id === user.id && q.user.email === user.email ? q
            : q.phase === "boot" || q.phase === "app" ? { phase: "app", user } : q));
        },
        (e: unknown) => {
          if (cancelled) return;
          if (e instanceof ApiFailure && e.status === 401) {
            if (phaseRef.current.phase === "app") {
              setPhase((q) => (q.phase === "app" ? { phase: "login", as: "learner", reason: "expired", email: q.user.email } : q));
              return;
            }
            // No learner session: maybe this is a parent's own device (a parent session only).
            api.parentMe().then(
              (me) => { if (!cancelled) setPhase((q) => (q.phase === "boot" ? { phase: "parent", me, learner: null } : q)); },
              (pe: unknown) => {
                if (cancelled) return;
                const next = bootPhase("none", pe instanceof ApiFailure && pe.status === 401 ? "none" : "offline");
                setPhase((q) => (q.phase !== "boot" ? q : next === "choose" ? { phase: "choose" } : { phase: "offlineNoAccount" }));
              },
            );
          } else {
            // Network or server trouble: a cached user keeps working offline.
            setPhase((q) => (q.phase === "boot" ? { phase: "offlineNoAccount" } : q));
          }
        },
    );
    return () => { cancelled = true; };
  }, [meTry]);

  // Opening parent mode: fetch the parent session's state (a 401 means "sign in as parent by email").
  useEffect(() => {
    if (phase.phase !== "parentBoot") return;
    let cancelled = false;
    const learner = phase.learner;
    api.parentMe().then(
      (me) => { if (!cancelled) setPhase({ phase: "parent", me, learner }); },
      (e: unknown) => {
        if (cancelled) return;
        if (e instanceof ApiFailure && e.status === 401) {
          setPhase(learner ? { phase: "login", as: "parent", email: learner.email, lockEmail: true } : { phase: "login", as: "parent" });
        } else {
          setPhase(learner ? { phase: "app", user: learner } : { phase: "offlineNoAccount" });
        }
      },
    );
    return () => { cancelled = true; };
  }, [phase]);

  useEffect(() => {
    if (phase.phase === "app") setCurrentUser(kv, phase.user);
  }, [phase]);

  const cachedLearner = (userId: string): User | null => {
    const u = loadCurrentUser(kv);
    return u && u.id === userId ? u : null;
  };

  const signedIn = (r: AuthSuccessResponse) => {
    setGuestChosen(kv, false);
    if (phaseAfterSignIn(r.scope) === "parent") {
      // A parent sign-in never touches the learner's current-user marker.
      setPhase({ phase: "parentBoot", learner: cachedLearner(r.user.id) });
      return;
    }
    setCurrentUser(kv, r.user);
    setPhase({ phase: "app", user: r.user });
  };

  const enterGuest = () => {
    setGuestChosen(kv, true);
    setPhase({ phase: "guest" });
  };
  const toChoose = () => setPhase({ phase: "choose" });

  switch (phase.phase) {
    case "boot":
    case "parentBoot":
      return <AuthFrame><p className="hint">Loading…</p></AuthFrame>;
    case "verify":
      return <VerifyLanding token={phase.token} as={phase.as} onSuccess={signedIn} onLogin={toChoose} />;
    case "choose":
      return <Choose reason={phase.reason} onPick={(as) => setPhase({ phase: "login", as })} onGuest={enterGuest} />;
    case "login": {
      const { as } = phase;
      return (
        <Login key={`${as}|${phase.email ?? ""}`} as={as} initialEmail={phase.email} lockEmail={phase.lockEmail} reason={phase.reason}
          onSent={(email) => setPhase({ phase: "checkEmail", as, email, ...(phase.lockEmail ? { lockEmail: true } : {}) })}
          onBack={() => {
            const learner = loadCurrentUser(kv);
            setPhase(phase.lockEmail && learner ? { phase: "app", user: learner } : { phase: "choose" });
          }}
          onGuest={enterGuest} />
      );
    }
    case "checkEmail": {
      const { as, email, lockEmail } = phase;
      return (
        <CheckEmail
          as={as}
          email={email}
          onSuccess={signedIn}
          onResend={(e) => setPhase({ phase: "login", as, email: e, ...(lockEmail ? { lockEmail: true } : {}) })}
          onDifferentEmail={() => setPhase(lockEmail ? { phase: "login", as, email, lockEmail } : { phase: "login", as })}
        />
      );
    }
    case "offlineNoAccount":
      return (
        <AuthFrame>
          <h2>You're offline</h2>
          <p>Connect to the internet to sign in.</p>
          <button className="btn primary big" onClick={() => { setPhase({ phase: "boot" }); setMeTry((n) => n + 1); }}>Retry</button>
          <GuestOption onGuest={enterGuest} />
          <LibraryOption />
        </AuthFrame>
      );
    case "guest":
      // Leaving guest mode keeps the guest's progress (v1 key) so parent mode can offer to move it in.
      // Ask the server first: this browser may still hold a valid session (signed in from another tab).
      return <GuestApp onSignIn={() => { setGuestChosen(kv, false); setPhase({ phase: "boot" }); setMeTry((n) => n + 1); }} />;
    case "app":
      return (
      <LearningApp
          key={phase.user.id}
          user={phase.user}
          onSignInAgain={() => setPhase({ phase: "login", as: "learner", reason: "expired", email: phase.user.email })}
          onParentSignIn={async (sync) => {
            await Promise.race([sync().catch(() => undefined), sleep(3000)]);
            setPhase({ phase: "parentBoot", learner: phase.user });
          }}
        />
      );
    case "parent":
      return (
        <ParentApp
          key={phase.me.user.id}
          me={phase.me}
          learner={phase.learner}
          onToLearner={(user) => { setCurrentUser(kv, user); setPhase({ phase: "app", user }); }}
          onSignedOut={() => {
            const learner = phase.learner;
            setPhase(learner ? { phase: "login", as: "parent", email: learner.email, lockEmail: true } : { phase: "login", as: "parent" });
          }}
          onChoose={toChoose}
        />
      );
  }
}
