import type { KV } from "./sync/store";

/** localStorage, or an in-memory stand-in when it is unavailable. */
function browserKV(): KV {
  try {
    const k = "baalpeh:probe";
    localStorage.setItem(k, "1");
    localStorage.removeItem(k);
    return localStorage;
  } catch {
    const m = new Map<string, string>();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
  }
}
export const kv: KV = browserKV();
