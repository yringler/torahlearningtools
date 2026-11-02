import catalog from "./data/index.json";
import type { Masechta, Mishnah } from "./types";

/**
 * The text is not bundled. `src/data/index.json` (a few hundred bytes per masechta) is bundled and lists one file per
 * masechta under /data/m/, named by content hash. The app fetches the file it needs; the service worker keeps it
 * offline. See scripts/build_data.py.
 */
export interface MasechtaEntry {
  id: string;
  he: string;
  en: string;
  /** URL of the masechta's JSON, e.g. /data/m/berakhot.55d502a8d3.json. */
  file: string;
  bytes: number;
  /** Number of mishnayos in each perek, in order. */
  perakim: number[];
}

export const CATALOG: readonly MasechtaEntry[] = catalog.masechtos;

/** Progress keys ("p:m") don't name a masechta yet, so the app learns one masechta: the first in the catalog. */
export const DEFAULT_MASECHTA_ID = CATALOG[0]?.id ?? "berakhot";

export const mKey = (perek: number, mishnah: number): string => `${perek}:${mishnah}`;

// The active masechta. These are live bindings: they are set once by setMasechta() before any screen renders
// (DataGate does this), and every importer sees the new values.
export let MASECHTA: Masechta = { masechta: "", masechtaEn: "", mishnayos: [] };
export let PERAKIM: number[] = [];
let activeId: string | null = null;
let byKey = new Map<string, Mishnah>();
let byPerek = new Map<number, Mishnah[]>();

export function setMasechta(id: string, m: Masechta): void {
  activeId = id;
  MASECHTA = m;
  byKey = new Map(m.mishnayos.map((x) => [mKey(x.perek, x.mishnah), x]));
  byPerek = new Map();
  for (const x of m.mishnayos) {
    const list = byPerek.get(x.perek);
    if (list) list.push(x);
    else byPerek.set(x.perek, [x]);
  }
  PERAKIM = [...byPerek.keys()];
}

export const isMasechtaLoaded = (id: string): boolean => activeId === id;

/** Fetch one masechta's text. Served from the service worker's cache when it has been downloaded before. */
export async function fetchMasechta(id: string, fetcher: typeof fetch = fetch): Promise<Masechta> {
  const entry = CATALOG.find((e) => e.id === id);
  if (!entry) throw new Error(`Unknown masechta ${id}`);
  const res = await fetcher(entry.file);
  if (!res.ok) throw new Error(`Loading ${entry.file} failed: HTTP ${res.status}`);
  const data = (await res.json()) as Masechta;
  if (!Array.isArray(data.mishnayos) || data.mishnayos.length === 0) throw new Error(`${entry.file} has no mishnayos`);
  return data;
}

const pending = new Map<string, Promise<void>>();

/**
 * Fetch a masechta and make it the active one. Concurrent and repeated calls share one request; a failed request
 * is forgotten so the next call retries. main.tsx starts this before sign-in finishes so the two overlap.
 */
export function loadMasechta(id: string): Promise<void> {
  if (isMasechtaLoaded(id)) return Promise.resolve();
  let p = pending.get(id);
  if (!p) {
    p = fetchMasechta(id).then(
      (m) => { setMasechta(id, m); pending.delete(id); },
      (e: unknown) => { pending.delete(id); throw e; },
    );
    pending.set(id, p);
  }
  return p;
}

export function getMishnah(perek: number, mishnah: number): Mishnah {
  const m = byKey.get(mKey(perek, mishnah));
  if (!m) throw new Error(`No mishnah ${perek}:${mishnah}`);
  return m;
}

export function mishnayosOf(perek: number): Mishnah[] {
  return byPerek.get(perek) ?? [];
}

const ONES = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"];
const TENS = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"];

/** 1–99 as Hebrew numerals with a geresh: 1 → א׳, 12 → יב׳, 15 → טו׳, 16 → טז׳. Some masechtos have 30 perakim. */
export const hebNum = (n: number): string => {
  if (!Number.isInteger(n) || n < 1 || n > 99) return String(n);
  if (n === 15) return "טו׳";
  if (n === 16) return "טז׳";
  return (TENS[Math.floor(n / 10)] ?? "") + (ONES[n % 10] ?? "") + "׳";
};
