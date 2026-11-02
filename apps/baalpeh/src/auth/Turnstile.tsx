import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

interface TurnstileRenderOptions {
  sitekey: string;
  action?: string;
  callback?: (token: string) => void;
  "expired-callback"?: () => void;
  "error-callback"?: () => void;
}

interface TurnstileApi {
  render(el: HTMLElement, opts: TurnstileRenderOptions): string;
  reset(id?: string): void;
  remove(id: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading: Promise<TurnstileApi> | null = null;

/** Loads the Turnstile script once per page. */
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!loading) {
    loading = new Promise<TurnstileApi>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = SCRIPT_URL;
      s.async = true;
      s.defer = true;
      s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile missing")));
      s.onerror = () => {
        loading = null;
        s.remove();
        reject(new Error("turnstile failed to load"));
      };
      document.head.appendChild(s);
    });
  }
  return loading;
}

export interface TurnstileHandle {
  reset(): void;
}

interface Props {
  siteKey: string;
  onToken: (token: string | null) => void;
  onLoadError?: () => void;
}

/** Cloudflare Turnstile widget. Calls onToken(null) when the token expires or the widget errors. */
export const Turnstile = forwardRef<TurnstileHandle, Props>(function Turnstile({ siteKey, onToken, onLoadError }, handle) {
  const el = useRef<HTMLDivElement>(null);
  const id = useRef<string | null>(null);
  const cb = useRef({ onToken, onLoadError });
  cb.current = { onToken, onLoadError };

  useImperativeHandle(handle, () => ({
    reset: () => {
      cb.current.onToken(null);
      if (id.current !== null) window.turnstile?.reset(id.current);
    },
  }), []);

  useEffect(() => {
    let cancelled = false;
    loadTurnstile().then((ts) => {
      if (cancelled || !el.current) return;
      id.current = ts.render(el.current, {
        sitekey: siteKey,
        action: "login",
        callback: (t) => cb.current.onToken(t),
        "expired-callback": () => cb.current.onToken(null),
        "error-callback": () => cb.current.onToken(null),
      });
    }, () => {
      if (!cancelled) cb.current.onLoadError?.();
    });
    return () => {
      cancelled = true;
      if (id.current !== null) window.turnstile?.remove(id.current);
      id.current = null;
    };
  }, [siteKey]);

  return <div className="turnstile" ref={el} />;
});
