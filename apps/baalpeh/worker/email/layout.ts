/** The loginEmail.ts card layout, shared by the parent-mode emails (docs/PARENT_MODE.md §6.8). */
import { escapeHtml } from "./html";

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

export type Block =
  | { h: string }
  | { p: string }
  | { small: string }
  | { button: string; href: string }
  | { code: string };

const P = "font-size:16px;line-height:1.5;margin:0 0 16px;";
const SMALL = "font-size:14px;line-height:1.5;color:#555;margin:0 0 12px;";

/** Builds the HTML card; every string is escaped here, so callers pass plain text. */
export function cardHtml(subject: string, blocks: Block[], footer?: string): string {
  const e = escapeHtml;
  const body = blocks
    .map((b) => {
      if ("h" in b) return `<h2 style="margin:0 0 16px;font-size:22px;line-height:1.3;">${e(b.h)}</h2>`;
      if ("p" in b) return `<p style="${P}">${e(b.p)}</p>`;
      if ("small" in b) return `<p style="${SMALL}">${e(b.small)}</p>`;
      if ("code" in b) {
        return `<p style="margin:0 0 24px;"><span style="display:inline-block;font-family:Menlo,Consolas,monospace;font-size:28px;letter-spacing:4px;padding:10px 18px;border:1px solid #ccc;border-radius:8px;background:#fafafa;">${e(b.code)}</span></p>`;
      }
      return `<p style="margin:0 0 24px;"><a href="${e(b.href)}" style="display:inline-block;background:#2f5d50;color:#fff;text-decoration:none;font-size:18px;font-weight:700;padding:14px 28px;border-radius:8px;">${e(b.button)}</a></p>`;
    })
    .join("\n");
  const foot = footer
    ? `\n<p style="font-size:12px;line-height:1.4;color:#888;margin:0;word-break:break-all;">${e(footer)}</p>`
    : "";
  return `<!doctype html>
<html lang="en" dir="ltr"><head><meta charset="utf-8"><title>${e(subject)}</title></head>
<body dir="ltr" style="margin:0;padding:24px;background:#f6f3ec;font-family:Helvetica,Arial,sans-serif;color:#222;">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;">
<h1 style="margin:0 0 4px;font-size:26px;font-weight:700;" dir="rtl" lang="he">${e("משנה בעל פה")}</h1>
<p style="margin:0 0 20px;font-size:16px;color:#555;">Mishnah Ba&#39;al Peh</p>
${body}${foot}
</div></body></html>`;
}

/** "Friday, November 6, 2026 at 9:41 PM" in `tz`, or in UTC when tz is missing or unknown. */
export function formatWhen(at: number, tz: string | undefined): { time: string; zone: string } {
  if (tz) {
    try {
      return { time: new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeStyle: "short", timeZone: tz }).format(at), zone: tz };
    } catch {
      // fall through to UTC
    }
  }
  return { time: new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeStyle: "short", timeZone: "UTC" }).format(at), zone: "UTC" };
}
