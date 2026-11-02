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

export const SOURCES: Record<Source, { name: string; detail: string; license: License; sefaria: string }> = {
  steinsaltz: {
    name: "Steinsaltz",
    detail: "R. Adin Even-Israel Steinsaltz, Koren Noé / William Davidson Edition, via Sefaria",
    license: LICENSES.ccByNc4,
    sefaria: "https://www.sefaria.org/Mishnah_Berakhot?ven=William_Davidson_Edition_-_English",
  },
  bartenura: {
    name: "Bartenura",
    detail: "R. Ovadiah of Bartenura, translated by R. Shraga Silverstein, via Sefaria",
    license: LICENSES.ccBy3,
    sefaria: "https://www.sefaria.org/Mishnah_Berakhot?ven=The_Mishna_with_Obadiah_Bartenura_by_Rabbi_Shraga_Silverstein",
  },
};

export const HEBREW_SOURCE = {
  name: "Torat Emet 357",
  license: LICENSES.publicDomain,
  sefaria: "https://www.sefaria.org/Mishnah_Berakhot?vhe=Torat_Emet_357",
};

/** Public path of the sources & licenses page. It opens without signing in. */
export const LICENSES_PATH = "/licenses";

export const sefariaUrl = (masechtaEn: string, perek: number, mishnah: number): string =>
  `https://www.sefaria.org/Mishnah_${masechtaEn}.${perek}.${mishnah}?lang=bi`;
