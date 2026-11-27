import type {
  ApiError, AuditLogResponse, AuthRequestBody, AuthRequestResponse, AuthSuccessResponse, ChildStatsResponse, ConfigResponse,
  DeleteAccountBody, EventsResponse, ForgotPinResponse, MeResponse, ParentMeResponse, PerekTestInfo, PerekTestRequestBody,
  PerekTestRequestResponse, PerekTestTokenBody, PinBody, PinResetBody, PinResetInfo, SetPinBody, SetVerificationsBody,
  SetVerificationsResponse, SyncRequest, SyncResponse, VerifyCodeBody, VerifyLinkBody,
} from "../../shared/api";

export class ApiFailure extends Error {
  constructor(readonly status: number, readonly body: ApiError | null) {
    super(body?.message ?? `HTTP ${status}`);
    this.name = "ApiFailure";
  }
}

export class NetworkFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkFailure";
  }
}

export async function call<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown, opts: { keepalive?: boolean } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(opts.keepalive ? { keepalive: true } : {}),
    });
  } catch (e) {
    throw new NetworkFailure(String(e));
  }
  if (res.status === 204) return undefined as T;
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new ApiFailure(res.status, isApiError(json) ? json : null);
  return json as T;
}

function isApiError(x: unknown): x is ApiError {
  return typeof x === "object" && x !== null && typeof (x as ApiError).error === "string";
}

const child = (id: string) => `/parent/children/${encodeURIComponent(id)}`;

export const api = {
  config: () => call<ConfigResponse>("GET", "/config"),
  /** `as` (default learner) decides which sign-in email goes out, and so which session the link or code makes. */
  requestLogin: (b: AuthRequestBody) => call<AuthRequestResponse>("POST", "/auth/request", b),
  verifyLink: (b: VerifyLinkBody) => call<AuthSuccessResponse>("POST", "/auth/verify-link", b),
  verifyCode: (b: VerifyCodeBody) => call<AuthSuccessResponse>("POST", "/auth/verify-code", b),
  /** Ends the learner session only. */
  logout: () => call<void>("POST", "/auth/logout", {}),
  me: () => call<MeResponse>("GET", "/me"),
  sync: (b: SyncRequest) => call<SyncResponse>("POST", "/sync", b),
  /** Ask for the perek test email (session). The server picks the recipient, the text and the name. */
  perekTest: (b: PerekTestRequestBody) => call<PerekTestRequestResponse>("POST", "/perek-tests", b),
  /** Read-only: who and what a test link is for (no session). */
  perekTestLookup: (b: PerekTestTokenBody) => call<PerekTestInfo>("POST", "/perek-tests/lookup", b),
  /** The parent's tap on the landing page (no session; the token, plus the PIN once one is set, is the credential). */
  perekTestConfirm: (b: PerekTestTokenBody) => call<PerekTestInfo>("POST", "/perek-tests/confirm", b),
  /** Emails a PIN reset link to the account of a live test link. */
  perekTestForgotPin: (b: { token: string }) => call<ForgotPinResponse>("POST", "/perek-tests/forgot-pin", b),

  // Parent mode (docs/PARENT_MODE.md §6.4). Every call reads only the parent cookie.
  parentMe: () => call<ParentMeResponse>("GET", "/parent/me"),
  parentUnlock: (b: PinBody) => call<ParentMeResponse>("POST", "/parent/unlock", b),
  /** A beacon: no body, survives the page closing. */
  parentLock: () => call<void>("POST", "/parent/lock", undefined, { keepalive: true }),
  parentSetPin: (b: SetPinBody) => call<ParentMeResponse>("POST", "/parent/pin", b),
  parentForgotPin: () => call<ForgotPinResponse>("POST", "/parent/pin/forgot", {}),
  parentLogout: () => call<void>("POST", "/parent/logout", {}),
  parentLearnerSession: () => call<MeResponse>("POST", "/parent/learner-session", {}),
  parentSync: (b: SyncRequest) => call<SyncResponse>("POST", "/parent/sync", b),
  parentSetVerifications: (childId: string, b: SetVerificationsBody) =>
    call<SetVerificationsResponse>("POST", `${child(childId)}/verifications`, b),
  parentLog: (before?: number, limit = 30) =>
    call<AuditLogResponse>("GET", `/parent/log?limit=${limit}${before ? `&before=${before}` : ""}`),
  parentDeleteAccount: (b: DeleteAccountBody) => call<void>("DELETE", "/parent/account", b),
  events: (childId: string, before?: number) =>
    call<EventsResponse>("GET", `${child(childId)}/events${before ? `?before=${before}` : ""}`),
  stats: (childId: string, days = 30) => call<ChildStatsResponse>("GET", `${child(childId)}/stats?days=${days}`),

  // PIN reset page (no session; the emailed token is the credential).
  pinResetLookup: (b: { token: string }) => call<PinResetInfo>("POST", "/pin-reset/lookup", b),
  pinReset: (b: PinResetBody) => call<void>("POST", "/pin-reset", b),
};
export type Api = typeof api;

/** The error code of a failed call, if the server sent one. */
export const errorCode = (e: unknown): string | null => (e instanceof ApiFailure ? e.body?.error ?? null : null);
