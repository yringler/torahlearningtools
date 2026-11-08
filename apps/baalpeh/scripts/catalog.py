"""Shared helper for the data scripts: reads data/catalog.json and knows where each masechta's files live.

Layout (per masechta id):
  data/<id>/raw/perek_N.json     Sefaria text: {"he": [...], <source>: [...]} (fetch_sefaria.py)
  data/<id>/chunks.json          mechanical phrase chunks + the sources' text per mishnah (chunk.py)
  data/<id>/gloss/perek_N.json   refined chunks with meanings (glossing, checked by validate_gloss.py)
  data/<id>/hide.json            child-suitability rules applied at build time (optional)
"""
import json, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CATALOG_PATH = DATA / "catalog.json"


def load() -> dict:
    cat = json.loads(CATALOG_PATH.read_text())
    sedarim = {s["id"] for s in cat["sedarim"]}
    ids = [m["id"] for m in cat["masechtos"]]
    if len(ids) != len(set(ids)):
        raise SystemExit("catalog.json: duplicate masechta id")
    if sum(1 for s in cat["sources"].values() if s.get("excerpts")) > 1:
        raise SystemExit("catalog.json: at most one source may have excerpts (chunk fields st/stMore)")
    for m in cat["masechtos"]:
        if m["seder"] not in sedarim:
            raise SystemExit(f"catalog.json: {m['id']} has unknown seder {m['seder']!r}")
        if m["sefaria"] != "Mishnah_" + m["en"]:
            raise SystemExit(f"catalog.json: {m['id']}: en must be the Sefaria name after 'Mishnah_' (app links use it)")
        for s in m["sources"]:
            if s not in cat["sources"]:
                raise SystemExit(f"catalog.json: {m['id']} names unknown source {s!r}")
    return cat


CATALOG = load()
SOURCES: dict = CATALOG["sources"]
MASECHTOS: list = CATALOG["masechtos"]


def masechta(mid: str) -> dict:
    for m in MASECHTOS:
        if m["id"] == mid:
            return m
    raise SystemExit(f"unknown masechta {mid!r}; catalog has: {', '.join(m['id'] for m in MASECHTOS)}")


def from_argv(usage: str) -> dict:
    """The masechta named by the first CLI argument."""
    if len(sys.argv) < 2:
        raise SystemExit(f"usage: {usage}")
    return masechta(sys.argv[1])


def excerpts_source(m: dict):
    """The masechta's source whose text is quoted verbatim in the gloss (st/stMore/stIntro), or None."""
    return next((s for s in m["sources"] if SOURCES[s].get("excerpts")), None)


def mdir(mid: str) -> pathlib.Path:
    return DATA / mid


def raw_dir(mid: str) -> pathlib.Path:
    return mdir(mid) / "raw"


def chunks_path(mid: str) -> pathlib.Path:
    return mdir(mid) / "chunks.json"


def gloss_dir(mid: str) -> pathlib.Path:
    return mdir(mid) / "gloss"


def hide_path(mid: str) -> pathlib.Path:
    return mdir(mid) / "hide.json"


def perek_of(path: pathlib.Path) -> int:
    return int(path.stem.split("_")[1])


def perek_files(d: pathlib.Path) -> list:
    return sorted(d.glob("perek_*.json"), key=perek_of)
