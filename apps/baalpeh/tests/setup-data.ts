import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CATALOG, DEFAULT_MASECHTA_ID, setMasechta } from "../src/data";
import type { Masechta } from "../src/types";

// The app fetches the masechta at runtime; tests read the same file from public/.
const entry = CATALOG.find((e) => e.id === DEFAULT_MASECHTA_ID);
if (!entry) throw new Error("No default masechta in src/data/index.json");
const path = fileURLToPath(new URL(`../public${entry.file}`, import.meta.url));
setMasechta(entry.id, JSON.parse(readFileSync(path, "utf8")) as Masechta);
