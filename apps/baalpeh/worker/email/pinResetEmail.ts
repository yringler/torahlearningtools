import { headerSafe } from "./html";
import { cardHtml, type EmailContent } from "./layout";

/** "Forgot PIN?" (docs/PARENT_MODE.md §6.8). */
export function pinResetEmail(i: { email: string; link: string }): EmailContent {
  const subject = headerSafe("Choose a new parent PIN for Mishnah Ba'al Peh");
  const intro = `Someone tapped "Forgot PIN?" for ${i.email}. Tap the button to choose a new 4-digit PIN:`;
  const lines = [
    "The link works once and expires in 1 hour. Only the newest email works.",
    "If you didn't ask for this, you can ignore it. Your PIN stays the same.",
    "Whenever the parent PIN changes, we'll email you.",
  ];
  const text = ["Choose a new parent PIN", "", intro, i.link, "", ...lines, ""].join("\n");
  const html = cardHtml(
    subject,
    [{ h: "Choose a new parent PIN" }, { p: intro }, { button: "Choose a new PIN", href: i.link }, ...lines.map((small) => ({ small }))],
    `If the button doesn't work, open this link: ${i.link}`,
  );
  return { subject, text, html };
}
