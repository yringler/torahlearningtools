import { deviceLabel } from "../../shared/device";
import { headerSafe } from "./html";
import { cardHtml, formatWhen, type EmailContent } from "./layout";

export type PinChangeKind = "set" | "changed" | "reset";

const HOW: Record<PinChangeKind, string> = {
  set: "set for the first time",
  changed: "changed in parent mode",
  reset: "reset with an email link",
};

/** "Your parent PIN was changed" — sent before every PIN set, change or reset is saved. No link token in it. */
export function pinNoticeEmail(i: {
  accountEmail: string;
  kind: PinChangeKind;
  at: number;
  tz: string | undefined;
  /** The parent session's sign-in email; null for a reset link. */
  loginEmail: string | null;
  userAgent: string;
  appOrigin: string;
}): EmailContent {
  const subject = headerSafe("Your parent PIN was changed");
  const { time, zone } = formatWhen(i.at, i.tz);
  const lines = [
    `The parent PIN for Mishnah Ba'al Peh (${i.accountEmail}) was ${HOW[i.kind]} on ${time} (${zone}).`,
    ...(i.loginEmail ? [`Signed in as: ${i.loginEmail}`] : []),
    `Device: ${deviceLabel(i.userAgent)}`,
    "If this was you, there's nothing to do.",
    `If it wasn't, someone may have used a parent's phone or email. Open ${i.appOrigin}, tap "Sign in as parent", then "Forgot PIN?" to choose a new one, and look at the change log in parent mode.`,
  ];
  const text = ["Your parent PIN was changed", "", ...lines.flatMap((l) => [l, ""])].join("\n");
  const html = cardHtml(subject, [{ h: "Your parent PIN was changed" }, ...lines.map((p) => ({ p }))]);
  return { subject, text, html };
}
