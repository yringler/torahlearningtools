import raw from "./data/berakhot.json";
import type { Masechta, Mishnah } from "./types";

export const MASECHTA = raw as Masechta;

export const mKey = (perek: number, mishnah: number): string => `${perek}:${mishnah}`;

const byKey = new Map<string, Mishnah>(MASECHTA.mishnayos.map((m) => [mKey(m.perek, m.mishnah), m]));

export function getMishnah(perek: number, mishnah: number): Mishnah {
  const m = byKey.get(mKey(perek, mishnah));
  if (!m) throw new Error(`No mishnah ${perek}:${mishnah}`);
  return m;
}

export function mishnayosOf(perek: number): Mishnah[] {
  return MASECHTA.mishnayos.filter((m) => m.perek === perek);
}

export const PERAKIM: number[] = [...new Set(MASECHTA.mishnayos.map((m) => m.perek))];

const HEB_NUM: Record<number, string> = {
  1: "א", 2: "ב", 3: "ג", 4: "ד", 5: "ה", 6: "ו", 7: "ז", 8: "ח", 9: "ט", 10: "י",
};
export const hebNum = (n: number): string => (HEB_NUM[n] ?? String(n)) + "׳";
