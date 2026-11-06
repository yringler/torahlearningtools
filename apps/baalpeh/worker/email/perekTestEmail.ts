/**
 * The "ready to be tested" email (docs/PARENT_VERIFICATION.md §6). Everything in it comes from the server: the name
 * and emoji from children.data, the text from worker/data/text.json. Never log the result: it carries the link.
 */
import { hebNum } from "../../shared/hebrew";
import { emailSafeEmoji, emailSafeName, escapeHtml, headerSafe } from "./html";

export interface PerekTestEmailInput {
  childName: string;
  childEmoji: string;
  masechtaHe: string;
  masechtaEn: string;
  perek: number;
  /** true when this is the masechta's last perek. */
  lastPerek: boolean;
  /** pieces[mishnahIndex][pieceIndex] = chunk.he */
  pieces: string[][];
  /** `${APP_ORIGIN}/perek-test#t=<token>` */
  link: string;
}

export interface PerekTestEmailContent {
  subject: string;
  text: string;
  html: string;
}

const HE_FONT = "'Frank Ruhl Libre','Noto Serif Hebrew','David','Times New Roman',serif";

export function perekTestEmail(i: PerekTestEmailInput): PerekTestEmailContent {
  const name = emailSafeName(i.childName);
  const emoji = emailSafeEmoji(i.childEmoji);
  const N = String(i.perek);
  const hebN = hebNum(i.perek);
  const M = i.masechtaHe;
  const En = i.masechtaEn;
  const nextLine = i.lastPerek ? `${En} is officially complete!` : "the next perek opens in the app.";
  const heading = `${emoji ? emoji + " " : ""}${name} learned a whole perek by heart!`;
  const subject = headerSafe(`🎉 ${name} finished ${En} Perek ${N}! Time for a quick test`);
  const heRef = `מסכת ${M} פרק ${hebN}`;

  const text = [
    "משנה בעל פה · Mishnah Ba'al Peh",
    "",
    heading,
    "",
    `${name} just finished ${En}, Perek ${N} (${heRef}) and tapped "I'm ready to be tested." That's a big deal, so please give ${name} a high five from us! 🙌`,
    "",
    `Your part: sit together and have ${name} say the whole perek by heart. The text is below so you can follow along. When ${name} knows it, tap the link, and ${nextLine}`,
    "",
    `Open ${name}'s test page:`,
    i.link,
    "",
    `Small slips are fine. You know best. If it needs more work, tap "Not yet" on the test page. ${name} can keep practicing, and you can test again later with the same link.`,
    "",
    "――――――――",
    `${En} Perek ${N}, phrase by phrase`,
    `The same pieces ${name} learned in the app.`,
    "",
    ...i.pieces.flatMap((m, idx) => [`משנה ${hebNum(idx + 1)}`, ...m, ""]),
    "This link works for 30 days on any phone or computer. No sign-in needed. It opens a page where you tap once to confirm.",
    `You got this email because ${name} asked to be tested in Mishnah Ba'al Peh. ${name} can send at most one test email every 10 minutes. If you didn't expect this, you can ignore it.`,
    `If the page doesn't show ${name}'s test, reload it once.`,
    "",
    i.link,
    "",
  ].join("\n");

  const e = escapeHtml;
  const n = e(name);
  const l = e(i.link);
  const p = (body: string, style = "font-size:16px;line-height:1.5;margin:0 0 16px;") => `<p style="${style}">${body}</p>`;
  const small = "font-size:13px;line-height:1.5;color:#777;margin:0 0 8px;";
  const mishnayos = i.pieces
    .map(
      (m, idx) =>
        `<div dir="rtl" lang="he" style="text-align:right;font-family:${HE_FONT};font-size:21px;line-height:1.9;margin:0 0 18px;">` +
        `<b>${e(`משנה ${hebNum(idx + 1)}`)}</b>` +
        m.map((piece) => `<div>${e(piece)}</div>`).join("") +
        `</div>`,
    )
    .join("\n");

  const html = `<!doctype html>
<html lang="en" dir="ltr"><head><meta charset="utf-8"><title>${e(subject)}</title></head>
<body dir="ltr" style="margin:0;padding:24px;background:#f6f3ec;font-family:Helvetica,Arial,sans-serif;color:#222;">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;">
<h1 style="margin:0 0 4px;font-size:26px;font-weight:700;" dir="rtl" lang="he">${e("משנה בעל פה")}</h1>
<p style="margin:0 0 20px;font-size:16px;color:#555;">Mishnah Ba&#39;al Peh</p>
<h2 style="margin:0 0 16px;font-size:22px;line-height:1.3;">${e(heading)}</h2>
${p(`${n} just finished <b>${e(`${En}, Perek ${N}`)}</b> (<span dir="rtl" lang="he">${e(heRef)}</span>) and tapped <b>&#34;I&#39;m ready to be tested.&#34;</b> That&#39;s a big deal, so please give ${n} a high five from us! 🙌`)}
${p(`<b>Your part:</b> sit together and have ${n} say the whole perek by heart. The text is below so you can follow along. When ${n} knows it, tap the button, and ${e(nextLine)}`)}
<p style="margin:0 0 24px;"><a href="${l}" style="display:inline-block;background:#2f5d50;color:#fff;text-decoration:none;font-size:18px;font-weight:700;padding:14px 28px;border-radius:8px;">${e(`Open ${name}'s test page`)}</a></p>
${p(`Small slips are fine. You know best. If it needs more work, tap &#34;Not yet&#34; on the test page. ${n} can keep practicing, and you can test again later with the same link.`)}
<hr style="border:none;border-top:1px solid #ddd;margin:24px 0;">
${p(`<b>${e(`${En} Perek ${N}, phrase by phrase`)}</b><br><i style="color:#555;">The same pieces ${n} learned in the app.</i>`)}
${mishnayos}
<hr style="border:none;border-top:1px solid #ddd;margin:24px 0;">
${p("This link works for 30 days on any phone or computer. No sign-in needed. It opens a page where you tap once to confirm.", small)}
${p(`You got this email because ${n} asked to be tested in Mishnah Ba&#39;al Peh. ${n} can send at most one test email every 10 minutes. If you didn&#39;t expect this, you can ignore it.`, small)}
${p(`If the button doesn&#39;t work, open: <span style="word-break:break-all;">${l}</span>`, small)}
${p(`If the page doesn&#39;t show ${n}&#39;s test, reload it once.`, small)}
</div></body></html>`;
  return { subject, text, html };
}
