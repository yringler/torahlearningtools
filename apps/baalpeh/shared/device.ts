/** "Safari on iPhone", "Chrome on Android", "Chrome on Windows", … or "a browser". Pure; used by emails and the log. */
export function deviceLabel(ua: string | null | undefined): string {
  const s = ua ?? "";
  if (s.trim() === "") return "a browser";
  const os = /iPhone/.test(s)
    ? "iPhone"
    : /iPad/.test(s)
      ? "iPad"
      : /Android/.test(s)
        ? "Android"
        : /Windows/.test(s)
          ? "Windows"
          : /CrOS/.test(s)
            ? "a Chromebook"
            : /Macintosh|Mac OS X/.test(s)
              ? "Mac"
              : /Linux/.test(s)
                ? "Linux"
                : null;
  const browser = /Edg(e|A|iOS)?\//.test(s)
    ? "Edge"
    : /SamsungBrowser\//.test(s)
      ? "Samsung Internet"
      : /(Firefox|FxiOS)\//.test(s)
        ? "Firefox"
        : /(Chrome|CriOS)\//.test(s)
          ? "Chrome"
          : /Safari\//.test(s) && /Version\//.test(s)
            ? "Safari"
            : /(iPhone|iPad)/.test(s)
              ? "Safari"
              : null;
  if (browser && os) return `${browser} on ${os}`;
  if (browser) return browser;
  if (os) return `a browser on ${os}`;
  return "a browser";
}
