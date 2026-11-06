/** HTML-safety helpers shared by every email. */

/** Escapes &, <, >, " and ' as numeric entities. Every interpolation into email HTML goes through this. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/** Control characters, bidi marks, embeddings/overrides (U+202A–U+202E) and isolates (U+2066–U+2069). */
const UNSAFE = /[\p{Cc}؜‎‏‪-‮⁦-⁩]/gu;
const NAME_MAX = 40;

/**
 * A child's name, safe to put in an email subject or body (before escapeHtml): no control or bidi characters (they
 * could reorder the copy around it), whitespace collapsed, at most 40 characters, "Your child" when nothing is left.
 */
export function emailSafeName(name: string): string {
  const s = Array.from(name.replace(UNSAFE, " ").replace(/\s+/g, " ").trim()).slice(0, NAME_MAX).join("").trim();
  return s.length > 0 ? s : "Your child";
}

/** The child's emoji when it is short and clean; otherwise "" (it is decoration only). */
export function emailSafeEmoji(emoji: string): string {
  const e = emoji.trim();
  if (e.length === 0 || Array.from(e).length > 16 || new RegExp(UNSAFE.source, "u").test(e)) return "";
  return e;
}

/** Plain-text header value: no CR/LF or other control characters. */
export function headerSafe(s: string): string {
  return s.replace(/[\p{Cc}]/gu, " ").replace(/\s+/g, " ").trim();
}
