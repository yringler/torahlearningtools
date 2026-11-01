import { useEffect, useState } from "react";
import { dueReviews, isKnown, mp, nextLearning, type Task } from "./progress";
import { Home } from "./screens/Home";
import { MishnahScreen } from "./screens/MishnahScreen";
import { Parent } from "./screens/Parent";
import { Profiles } from "./screens/Profiles";
import { Session } from "./screens/Session";
import { load, requestPersist, save } from "./storage";
import type { AppState, Profile } from "./types";

type Screen =
  | { s: "profiles" }
  | { s: "parent" }
  | { s: "home"; id: string }
  | { s: "mishnah"; id: string; perek: number; mishnah: number }
  | { s: "session"; id: string; tasks: Task[]; continueLearning: boolean; back: Screen };

export function App() {
  const [state, setState] = useState<AppState>(load);
  const [screen, setScreen] = useState<Screen>(() => (state.profiles.length ? { s: "profiles" } : { s: "parent" }));

  useEffect(() => save(state), [state]);
  useEffect(() => requestPersist(), []);

  const profile = "id" in screen ? state.profiles.find((p) => p.id === screen.id) : undefined;
  const setProfile = (p: Profile) =>
    setState((st) => ({ ...st, profiles: st.profiles.map((x) => (x.id === p.id ? p : x)) }));

  useEffect(() => {
    document.documentElement.style.setProperty("--scale", String(profile?.settings.fontScale ?? 1));
  }, [profile?.settings.fontScale]);

  if (screen.s === "parent") return <Parent state={state} onState={setState} onBack={() => setScreen({ s: "profiles" })} />;
  if (screen.s === "profiles" || !profile)
    return <Profiles profiles={state.profiles} onPick={(id) => setScreen({ s: "home", id })} onParent={() => setScreen({ s: "parent" })} />;

  if (screen.s === "home") {
    return (
      <Home
        profile={profile}
        onBack={() => setScreen({ s: "profiles" })}
        onOpenMishnah={(perek, mishnah) => setScreen({ s: "mishnah", id: profile.id, perek, mishnah })}
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
        onBack={() => setScreen({ s: "home", id: profile.id })}
        onPractice={() => go({ type: "learn", perek, mishnah })}
        onView={(v) => setProfile({ ...profile, settings: { ...profile.settings, meaningView: v } })}
        onReview={() => (isKnown(st) ? go({ type: "review-m", perek, mishnah }) : go({ type: "learn", perek, mishnah }))}
      />
    );
  }

  return (
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
