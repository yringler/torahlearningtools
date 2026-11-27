import { deviceLabel } from "../../shared/device";
import { headerSafe } from "./html";
import { cardHtml, formatWhen, type EmailContent } from "./layout";

/** Sent (best effort) when the 5th wrong PIN locks it. */
export function pinLockedEmail(i: {
  at: number;
  tz: string | undefined;
  where: "parent" | "test_page";
  userAgent: string;
  appOrigin: string;
}): EmailContent {
  const subject = headerSafe("Your parent PIN was locked");
  const { time, zone } = formatWhen(i.at, i.tz);
  const where = i.where === "parent" ? "in parent mode" : "on a perek test page";
  const lines = [
    `Someone typed a wrong parent PIN 5 times, on ${time} (${zone}), ${where}. Device: ${deviceLabel(i.userAgent)}.`,
    "The PIN is locked. Parent mode and test confirmations need a new PIN.",
    `To choose one, open ${i.appOrigin}, tap "Sign in as parent", then "Forgot PIN?".`,
  ];
  const text = ["Your parent PIN was locked", "", ...lines.flatMap((l) => [l, ""])].join("\n");
  const html = cardHtml(subject, [{ h: "Your parent PIN was locked" }, ...lines.map((p) => ({ p }))]);
  return { subject, text, html };
}
