/** Hebrew numerals, shared by the SPA and the Worker so the app, the email and the landing page match. */

const ONES = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"];
const TENS = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"];

/** 1–99 as Hebrew numerals with a geresh: 1 → א׳, 12 → יב׳, 15 → טו׳, 16 → טז׳. Some masechtos have 30 perakim. */
export const hebNum = (n: number): string => {
  if (!Number.isInteger(n) || n < 1 || n > 99) return String(n);
  if (n === 15) return "טו׳";
  if (n === 16) return "טז׳";
  return (TENS[Math.floor(n / 10)] ?? "") + (ONES[n % 10] ?? "") + "׳";
};
