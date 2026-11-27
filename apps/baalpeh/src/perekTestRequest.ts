import { PEREK_TEST } from "../shared/api";
import { ApiFailure, NetworkFailure } from "./api/client";
import type { RequestResult } from "./perekTest";

/** Maps a failed POST /api/perek-tests to what the child sees. */
export function requestErrorResult(e: unknown): RequestResult {
  if (e instanceof NetworkFailure) return { kind: "offline" };
  if (e instanceof ApiFailure) {
    if (e.status === 401) return { kind: "signedOut" };
    if (e.status === 429) {
      const retryAfterSec = Math.max(1, Math.round(e.body?.retryAfterSec ?? PEREK_TEST.COOLDOWN_SEC));
      // Only the server's per-child cooldown means a test is already on its way; anything else is the account cap.
      return e.body?.reason === "cooldown" ? { kind: "cooldown", retryAfterSec } : { kind: "cap", retryAfterSec };
    }
    if (e.status === 400 && e.body?.message === "not_frontier") return { kind: "notFrontier" };
  }
  return { kind: "failed" };
}

