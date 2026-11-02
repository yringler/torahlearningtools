import type { User } from "../shared/api";
import { emptyStore, type AccountStore } from "../src/sync/store";
import type { Profile } from "../src/types";

export const USER: User = { id: "user-1", email: "p@example.com", createdAt: 1 };

let n = 0;
export function kid(name: string, extra: Partial<Profile> = {}): Profile {
  n += 1;
  return {
    id: `child-${name}-${n}`.padEnd(10, "x"),
    name,
    color: "#2f7d6d",
    emoji: "🦁",
    settings: { fontScale: 1, tts: false, dailyMinutes: 15 },
    mishnayos: {},
    perakim: {},
    days: [],
    ...extra,
  };
}

export const store = (profiles: Profile[] = []): AccountStore => ({ ...emptyStore(USER), profiles });
