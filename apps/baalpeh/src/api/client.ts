import type {
  ApiError, AuthRequestBody, AuthRequestResponse, AuthSuccessResponse, ChildStatsResponse, ConfigResponse,
  DeleteAccountBody, EventsResponse, MeResponse, SyncRequest, SyncResponse, VerifyCodeBody, VerifyLinkBody,
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

export async function call<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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

export const api = {
  config: () => call<ConfigResponse>("GET", "/config"),
  requestLogin: (b: AuthRequestBody) => call<AuthRequestResponse>("POST", "/auth/request", b),
  verifyLink: (b: VerifyLinkBody) => call<AuthSuccessResponse>("POST", "/auth/verify-link", b),
  verifyCode: (b: VerifyCodeBody) => call<AuthSuccessResponse>("POST", "/auth/verify-code", b),
  logout: () => call<void>("POST", "/auth/logout", {}),
  me: () => call<MeResponse>("GET", "/me"),
  deleteAccount: (b: DeleteAccountBody) => call<void>("DELETE", "/account", b),
  sync: (b: SyncRequest) => call<SyncResponse>("POST", "/sync", b),
  events: (childId: string, before?: number) =>
    call<EventsResponse>("GET", `/children/${encodeURIComponent(childId)}/events${before ? `?before=${before}` : ""}`),
  stats: (childId: string, days = 30) =>
    call<ChildStatsResponse>("GET", `/children/${encodeURIComponent(childId)}/stats?days=${days}`),
};
export type Api = typeof api;

/** The error code of a failed call, if the server sent one. */
export const errorCode = (e: unknown): string | null => (e instanceof ApiFailure ? e.body?.error ?? null : null);
