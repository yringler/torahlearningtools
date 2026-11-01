import type { Source } from "./types";

export const SOURCES: Record<Source, { name: string; detail: string }> = {
  steinsaltz: {
    name: "Steinsaltz",
    detail: "R. Adin Even-Israel Steinsaltz, Koren Noé / William Davidson Edition (Sefaria, CC-BY-NC)",
  },
  bartenura: {
    name: "Bartenura",
    detail: "R. Ovadiah of Bartenura, translated by R. Shraga Silverstein (Sefaria, CC-BY)",
  },
};

export const sefariaUrl = (masechtaEn: string, perek: number, mishnah: number): string =>
  `https://www.sefaria.org/Mishnah_${masechtaEn}.${perek}.${mishnah}?lang=bi`;
