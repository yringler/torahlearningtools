import type { Source } from "./types";

export interface License {
  name: string;
  url: string;
}

/** License URLs match the ones Sefaria links for each version (Sefaria's license map: CC-BY is 3.0, CC-BY-NC is 4.0). */
export const LICENSES = {
  publicDomain: { name: "Public domain", url: "https://en.wikipedia.org/wiki/Public_domain" },
  ccBy3: { name: "CC BY 3.0", url: "https://creativecommons.org/licenses/by/3.0/" },
  ccByNc4: { name: "CC BY-NC 4.0", url: "https://creativecommons.org/licenses/by-nc/4.0/" },
} satisfies Record<string, License>;

/** A masechta on Sefaria in one version. `book` is the catalog's `sefaria` (e.g. "Mishnah_Berakhot", "Pirkei_Avot"). */
const versionUrl = (book: string, param: "ven" | "vhe", version: string): string =>
  `https://www.sefaria.org/${book}?${param}=${version}`;

export const SOURCES: Record<Source, { name: string; detail: string; license: License; sefaria: (book: string) => string }> = {
  steinsaltz: {
    name: "Steinsaltz",
    detail: "R. Adin Even-Israel Steinsaltz, Koren Noé / William Davidson Edition, via Sefaria",
    license: LICENSES.ccByNc4,
    sefaria: (m) => versionUrl(m, "ven", "William_Davidson_Edition_-_English"),
  },
  bartenura: {
    name: "Bartenura",
    detail: "R. Ovadiah of Bartenura, translated by R. Shraga Silverstein, via Sefaria",
    license: LICENSES.ccBy3,
    sefaria: (m) => versionUrl(m, "ven", "The_Mishna_with_Obadiah_Bartenura_by_Rabbi_Shraga_Silverstein"),
  },
};

export const HEBREW_SOURCE = {
  name: "Torat Emet 357",
  license: LICENSES.publicDomain,
  sefaria: (book: string): string => versionUrl(book, "vhe", "Torat_Emet_357"),
};

/** Public path of the sources & licenses page. It opens without signing in. */
export const LICENSES_PATH = "/licenses";

/** One mishnah on Sefaria. `book` is the catalog's `sefaria` (e.g. "Mishnah_Berakhot"). */
export const sefariaUrl = (book: string, perek: number, mishnah: number): string =>
  `https://www.sefaria.org/${book}.${perek}.${mishnah}?lang=bi`;
