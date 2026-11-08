import index from "./data/index.json";
import type { Masechta, Mishnah } from "./types";

/**
 * The text is not bundled. `src/data/index.json` (a few hundred bytes per masechta) is bundled and lists one file per
 * masechta under /data/m/, named by content hash, grouped by seder. The app fetches the file it needs; the service
 * worker keeps it offline. See scripts/build_data.py and data/catalog.json.
 */
export interface MasechtaEntry {
  id: string;
  he: string;
  /** Sefaria's name for it, after "Mishnah_" (e.g. "Berakhot"); sefariaUrl() builds links from it. */
  en: string;
  /** URL of the masechta's JSON, e.g. /data/m/berakhot.55d502a8d3.json. */
  file: string;
  bytes: number;
  /** Number of mishnayos in each perek, in order. */
  perakim: number[];
  /** False for a Hebrew-only masechta: its summary, `en` and word glosses are "" and it has no Steinsaltz. */
  translated: boolean;
}

/** A catalog entry with the id of its seder. */
export interface CatalogEntry extends MasechtaEntry {
  seder: string;
}

export interface Seder {
  id: string;
  he: string;
  en: string;
  masechtos: readonly MasechtaEntry[];
}

/** The shape of a masechta's progress: mishnayos per perek. Needs no text, so it works before the file is loaded. */
export interface MasechtaShape {
  id: string;
  /** perakim[p - 1] = number of mishnayos in perek p. */
  perakim: readonly number[];
}

export const SEDARIM: readonly Seder[] = index.sedarim;

/** Every masechta, in catalog order (seder by seder). */
export const CATALOG: readonly CatalogEntry[] = SEDARIM.flatMap((s) => s.masechtos.map((m) => ({ ...m, seder: s.id })));

/**
 * The masechta that progress keys without a masechta ("p:m") belong to. Fixed on purpose: it defines what older saved
 * progress means, so it must never follow the catalog's order.
 */
export const DEFAULT_MASECHTA_ID = "berakhot";

export const entryOf = (id: string): CatalogEntry | undefined => CATALOG.find((e) => e.id === id);

export const sederOf = (id: string): Seder | undefined => {
  const e = entryOf(id);
  return e && SEDARIM.find((s) => s.id === e.seder);
};

/** Mishnayos per perek of a catalog masechta. Throws for an unknown id. */
export function shapeOf(id: string): MasechtaShape {
  const e = entryOf(id);
  if (!e) throw new Error(`Unknown masechta ${id}`);
  return { id, perakim: e.perakim };
}

/** Whether the masechta has meanings (false for Hebrew-only masechtos and unknown ids). */
export const isTranslated = (id: string): boolean => entryOf(id)?.translated ?? false;

export const mKey = (perek: number, mishnah: number): string => `${perek}:${mishnah}`;

// The active masechta. These are live bindings: they are set by setMasechta() (via loadMasechta) before any screen
// that reads them renders (DataGate does this), and every importer sees the new values.
export let MASECHTA: Masechta = { masechta: "", masechtaEn: "", mishnayos: [] };
export let PERAKIM: number[] = [];
let activeId: string | null = null;
let byKey = new Map<string, Mishnah>();
let byPerek = new Map<number, Mishnah[]>();

/** Masechtos already fetched in this page, by id. Switching back to one is instant and needs no request. */
const loaded = new Map<string, Masechta>();
/** In-flight fetches by id, shared by every caller. */
const pending = new Map<string, Promise<Masechta>>();
/** Bumped by every loadMasechta() call: only the latest call activates its masechta when its fetch completes. */
let loadSeq = 0;

/** Make `m` the active masechta (and remember it). loadMasechta() is the normal way in; tests call this directly. */
export function setMasechta(id: string, m: Masechta): void {
  loaded.set(id, m);
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

/** The id of the active masechta, or "" before any has been loaded. */
export const activeMasechtaId = (): string => activeId ?? "";

/** Whether `id` is the active masechta (its text can be read through MASECHTA, getMishnah, …). */
export const isMasechtaLoaded = (id: string): boolean => activeId === id;

/**
 * Throws unless `id` is the active masechta. Functions that read the text (pieces, words) take the masechta they mean
 * and call this, so progress can never be written against the wrong masechta's text.
 */
export function assertActive(id: string): void {
  if (activeId !== id) throw new Error(`Masechta ${id} is not the active one (${activeId ?? "none"})`);
}

/** Perek numbers 1..n of a masechta shape. */
export const perakimOf = (ms: MasechtaShape): number[] => ms.perakim.map((_, i) => i + 1);

/** Number of mishnayos in a perek (0 outside the masechta). */
export const perekSize = (ms: MasechtaShape, perek: number): number => ms.perakim[perek - 1] ?? 0;

/** Number of mishnayos in the whole masechta. */
export const mishnayosCount = (ms: MasechtaShape): number => ms.perakim.reduce((a, b) => a + b, 0);

/** Whether `id` is in memory (active or loaded earlier), so loadMasechta(id) completes without a request. */
export const isMasechtaCached = (id: string): boolean => loaded.has(id);

/** Fetch one masechta's text. Served from the service worker's cache when it has been downloaded before. */
export async function fetchMasechta(id: string, fetcher: typeof fetch = fetch): Promise<Masechta> {
  const entry = entryOf(id);
  if (!entry) throw new Error(`Unknown masechta ${id}`);
  const res = await fetcher(entry.file);
  if (!res.ok) throw new Error(`Loading ${entry.file} failed: HTTP ${res.status}`);
  const data = (await res.json()) as Masechta;
  if (!Array.isArray(data.mishnayos) || data.mishnayos.length === 0) throw new Error(`${entry.file} has no mishnayos`);
  return data;
}

/** The masechta from memory, or one shared request for it. A failed request is forgotten so the next call retries. */
function obtain(id: string, fetcher: typeof fetch): Promise<Masechta> {
  const hit = loaded.get(id);
  if (hit) return Promise.resolve(hit);
  let p = pending.get(id);
  if (!p) {
    p = fetchMasechta(id, fetcher).then(
      (m) => { loaded.set(id, m); pending.delete(id); return m; },
      (e: unknown) => { pending.delete(id); throw e; },
    );
    pending.set(id, p);
  }
  return p;
}

/**
 * Make a masechta the active one, fetching it first unless it is already in memory. Concurrent calls for the same id
 * share one request. If the fetch fails the promise rejects and the active masechta stays as it was. When calls for
 * different masechtos overlap, the most recent call decides which one ends up active. main.tsx starts this before
 * sign-in finishes so the two overlap.
 */
export function loadMasechta(id: string, fetcher: typeof fetch = fetch): Promise<void> {
  const seq = ++loadSeq;
  if (isMasechtaLoaded(id)) return Promise.resolve();
  const cached = loaded.get(id);
  if (cached) {
    setMasechta(id, cached);
    return Promise.resolve();
  }
  return obtain(id, fetcher).then((m) => {
    if (seq === loadSeq) setMasechta(id, m);
  });
}

/** Fetch a masechta into memory (and so into the service worker's cache) without making it active. */
export function prefetchMasechta(id: string, fetcher: typeof fetch = fetch): Promise<void> {
  return obtain(id, fetcher).then(() => undefined);
}

/** The service worker's cache of masechta files (sw/sw.ts). */
const DATA_CACHE = "data-v1";

/** Whether this masechta's current file is saved on the device (so it opens offline). False where there is no Cache API. */
export async function isDownloaded(id: string): Promise<boolean> {
  const entry = entryOf(id);
  // The app's DOM lib doesn't declare the Cache API, so describe the little that is used here.
  const storage = (globalThis as { caches?: { open(name: string): Promise<{ match(url: string): Promise<Response | undefined> }> } }).caches;
  if (!entry || !storage) return false;
  try {
    const cache = await storage.open(DATA_CACHE);
    return (await cache.match(entry.file)) !== undefined;
  } catch {
    return false;
  }
}

export function getMishnah(perek: number, mishnah: number): Mishnah {
  const m = byKey.get(mKey(perek, mishnah));
  if (!m) throw new Error(`No mishnah ${perek}:${mishnah}`);
  return m;
}

export function mishnayosOf(perek: number): Mishnah[] {
  return byPerek.get(perek) ?? [];
}

/** 1–99 as Hebrew numerals (moved to shared/hebrew.ts so the Worker formats them identically). */
export { hebNum } from "../shared/hebrew";
