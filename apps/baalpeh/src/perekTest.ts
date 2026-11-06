import { PEREK_TEST, type Ms } from "../shared/api";
import type { KV, LastTest } from "./sync/store";

/**
 * Client side of the parent's email test of a perek (docs/PARENT_VERIFICATION.md §10.1). Pure helpers; the screens
 * are the test step in Session (the merged PerekReady) and the landing page (PerekTestLanding). No API client here:
 * guest mode loads this module and must never load the client.
 */

/** What asking for the test email led to. */
export type RequestResult =
  | { kind: "sent" | "already" }
  | { kind: "cooldown"; retryAfterSec: number }
  | { kind: "offline" | "signedOut" | "failed" | "notFrontier" };

/** Whole minutes until another test email may be sent, rounded up; 0 once it may. */
export function minutesLeft(nextAllowedAt: Ms, serverNow: Ms): number {
  const ms = nextAllowedAt - serverNow;
  return ms <= 0 ? 0 : Math.ceil(ms / 60_000);
}

/** Whole minutes since the email was sent (never negative). */
export const minutesAgo = (sentAt: Ms, serverNow: Ms): number => Math.max(0, Math.floor((serverNow - sentAt) / 60_000));

/** "just now", "1 minute ago", "12 minutes ago", "3 hours ago", "2 days ago". */
export function agoText(sentAt: Ms, serverNow: Ms): string {
  const min = minutesAgo(sentAt, serverNow);
  if (min < 1) return "just now";
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

/** This device's request for this perek, while its link can still work (30 days). */
export function liveTest(t: LastTest | undefined, masechta: string, perek: number, serverNow: Ms): LastTest | null {
  if (!t || t.masechta !== masechta || t.perek !== perek) return null;
  return serverNow - t.sentAt < PEREK_TEST.TOKEN_TTL_SEC * 1000 ? t : null;
}

/** What to remember after a 429: the server's countdown. Only a per-child cooldown (≤ 10 min) counts as "already sent". */
export function cooldownTest(masechta: string, perek: number, retryAfterSec: number, serverNow: Ms): LastTest | null {
  if (retryAfterSec > PEREK_TEST.COOLDOWN_SEC) return null;
  return { masechta, perek, sentAt: serverNow - (PEREK_TEST.COOLDOWN_SEC - retryAfterSec) * 1000, nextAllowedAt: serverNow + retryAfterSec * 1000 };
}

// Celebrate-once flags: the big "It's official!" shows once per verification per device. A verify, un-verify,
// verify sequence celebrates again, because the stored verifiedAt differs.
const celebratedKey = (childId: string, masechta: string, perek: number) => `baalpeh:v2:celebrated:${childId}:${masechta}:${perek}`;

export function wasCelebrated(kv: KV, childId: string, masechta: string, perek: number, verifiedAt: Ms): boolean {
  try {
    return kv.getItem(celebratedKey(childId, masechta, perek)) === String(verifiedAt);
  } catch {
    return false;
  }
}

export function markCelebrated(kv: KV, childId: string, masechta: string, perek: number, verifiedAt: Ms): void {
  try {
    kv.setItem(celebratedKey(childId, masechta, perek), String(verifiedAt));
  } catch {
    /* storage unavailable: it may celebrate again, which is harmless */
  }
}

const introKey = (childId: string) => `baalpeh:v2:verif-intro:${childId}`;

export function introSeen(kv: KV, childId: string): boolean {
  try {
    return kv.getItem(introKey(childId)) === "1";
  } catch {
    return true;
  }
}

export function markIntroSeen(kv: KV, childId: string): void {
  try {
    kv.setItem(introKey(childId), "1");
  } catch {
    /* ignore */
  }
}

/** The exact "Continue as a guest" copy (owner's wording, docs/PARENT_VERIFICATION.md §9). */
export const GUEST_LEAD = "Want to keep going?";
export const GUEST_BODY = "Continue as a guest. It won't count toward your progress, but you can keep learning Torah.";
export const GUEST_BUTTON = "Continue as a guest";

/** Said after an import into an account: imported children start with no verified perakim. */
export const IMPORT_TEST_NOTE = "Perek tests start fresh for imported children: each perek opens after you test it.";
