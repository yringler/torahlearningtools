import { useEffect, useRef, useState } from "react";
import type { AuthSuccessResponse, User } from "../shared/api";
import { api, ApiFailure } from "./api/client";
import { CheckEmail } from "./auth/CheckEmail";
import { AuthFrame, GuestOption, Login } from "./auth/Login";
import { takeVerifyToken, VerifyLanding } from "./auth/VerifyLanding";
import { DataGate } from "./components/DataGate";
import { asksServer, bootRoute, isGuestChosen, setGuestChosen } from "./guest";
import { GuestApp } from "./GuestApp";
import { LicensesPage } from "./components/Licenses";
import { LICENSES_PATH } from "./sources";
import { kv } from "./kv";
import { LearningApp } from "./LearningApp";
import { loadCurrentUser, setCurrentUser } from "./sync/store";

type Phase =
  | { phase: "boot" }
  | { phase: "verify"; token: string }
  | { phase: "login"; reason?: "expired"; email?: string }
  | { phase: "checkEmail"; email: string }
  | { phase: "offlineNoAccount" }
  | { phase: "guest" }
  | { phase: "app"; user: User };

// Read once per page load, before React renders (the fragment is stripped immediately).
const verifyToken = typeof window === "undefined" ? null : takeVerifyToken();

function initialPhase(): Phase {
  const cached = loadCurrentUser(kv);
  switch (bootRoute({ verifyToken, guest: isGuestChosen(kv), cachedUser: cached !== null })) {
    case "verify": return { phase: "verify", token: verifyToken ?? "" };
    case "guest": return { phase: "guest" };
    case "app": return cached ? { phase: "app", user: cached } : { phase: "boot" };
    case "boot": return { phase: "boot" };
  }
}

/** Routes by path: the public sources & licenses page needs no sign-in; everything else goes through the auth shell. */
export function App() {
  if (typeof window !== "undefined" && window.location.pathname.replace(/\/+$/, "") === LICENSES_PATH) return <LicensesPage />;
  return <AuthShell />;
}

/** Auth shell: decides between the sign-in screens and the learning app. */
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
            setPhase((q) => (q.phase === "app" ? { phase: "login", reason: "expired", email: q.user.email } : q.phase === "boot" ? { phase: "login" } : q));
          } else {
            // Network or server trouble: a cached user keeps working offline.
            setPhase((q) => (q.phase === "boot" ? { phase: "offlineNoAccount" } : q));
          }
        },
    );
    return () => { cancelled = true; };
  }, [meTry]);

  useEffect(() => {
    if (phase.phase === "app") setCurrentUser(kv, phase.user);
  }, [phase]);

  const signedIn = (r: AuthSuccessResponse) => {
    setGuestChosen(kv, false);
    setCurrentUser(kv, r.user);
    setPhase({ phase: "app", user: r.user });
  };

  const enterGuest = () => {
    setGuestChosen(kv, true);
    setPhase({ phase: "guest" });
  };

  switch (phase.phase) {
    case "boot":
      return <AuthFrame><p className="hint">Loading…</p></AuthFrame>;
    case "verify":
      return <VerifyLanding token={phase.token} onSuccess={signedIn} onLogin={() => setPhase({ phase: "login" })} />;
    case "login":
      return <Login key={phase.email ?? ""} initialEmail={phase.email} reason={phase.reason} onSent={(email) => setPhase({ phase: "checkEmail", email })} onGuest={enterGuest} />;
    case "checkEmail":
      return (
        <CheckEmail
          email={phase.email}
          onSuccess={signedIn}
          onResend={(email) => setPhase({ phase: "login", email })}
          onDifferentEmail={() => setPhase({ phase: "login" })}
        />
      );
    case "offlineNoAccount":
      return (
        <AuthFrame>
          <h2>You're offline</h2>
          <p>Connect to the internet to sign in.</p>
          <button className="btn primary big" onClick={() => { setPhase({ phase: "boot" }); setMeTry((n) => n + 1); }}>Retry</button>
          <GuestOption onGuest={enterGuest} />
        </AuthFrame>
      );
    case "guest":
      // Leaving guest mode keeps the guest's progress (v1 key) so the account's import prompt can offer it.
      // Ask the server first: this browser may still hold a valid session (signed in from another tab).
      return (
        <DataGate>
          <GuestApp onSignIn={() => { setGuestChosen(kv, false); setPhase({ phase: "boot" }); setMeTry((n) => n + 1); }} />
        </DataGate>
      );
    case "app":
      return (
        <DataGate>
          <LearningApp
            key={phase.user.id}
            user={phase.user}
            onSignedOut={() => setPhase({ phase: "login" })}
            onSignInAgain={() => setPhase({ phase: "login", reason: "expired", email: phase.user.email })}
          />
        </DataGate>
      );
  }
}
