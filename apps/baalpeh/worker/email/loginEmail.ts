export interface LoginEmailContent {
  subject: string;
  text: string;
  html: string;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

export function loginEmail(link: string, code: string): LoginEmailContent {
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
  const subject = `${code} is your Mishnah Ba'al Peh sign-in code`;
  const text = [
    "Sign in to Mishnah Ba'al Peh",
    "",
    "Tap this link to sign in on the device where you open it:",
    link,
    "",
    `Or type this code in the app:  ${spaced}`,
    "",
    "The link and code work once and expire in 15 minutes. Only the newest email works.",
    "If you didn't ask to sign in, you can ignore this email.",
    "",
  ].join("\n");
  const l = escapeHtml(link);
  const html = `<!doctype html>
<html lang="en" dir="ltr"><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body dir="ltr" style="margin:0;padding:24px;background:#f6f3ec;font-family:Helvetica,Arial,sans-serif;color:#222;">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;">
<h1 style="margin:0 0 4px;font-size:26px;font-weight:700;" dir="rtl" lang="he">${escapeHtml("משנה בעל פה")}</h1>
<p style="margin:0 0 20px;font-size:16px;color:#555;">Mishnah Ba&#39;al Peh</p>
<p style="font-size:16px;line-height:1.5;margin:0 0 16px;">Tap this button to sign in on the device where you open it:</p>
<p style="margin:0 0 24px;"><a href="${l}" style="display:inline-block;background:#2f5d50;color:#fff;text-decoration:none;font-size:18px;font-weight:700;padding:14px 28px;border-radius:8px;">Sign in</a></p>
<p style="font-size:16px;line-height:1.5;margin:0 0 8px;">Or type this code in the app:</p>
<p style="margin:0 0 24px;"><span style="display:inline-block;font-family:Menlo,Consolas,monospace;font-size:28px;letter-spacing:4px;padding:10px 18px;border:1px solid #ccc;border-radius:8px;background:#fafafa;">${escapeHtml(spaced)}</span></p>
<p style="font-size:14px;line-height:1.5;color:#555;margin:0 0 8px;">The link and code work once and expire in 15 minutes. Only the newest email works.</p>
<p style="font-size:14px;line-height:1.5;color:#555;margin:0 0 16px;">If you didn&#39;t ask to sign in, you can ignore this email.</p>
<p style="font-size:12px;line-height:1.4;color:#888;margin:0;word-break:break-all;">If the button does not work, open this link: ${l}</p>
</div></body></html>`;
  return { subject, text, html };
}
