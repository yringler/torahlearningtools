"""Merge data/chunks.json + data/gloss/perek_*.json into src/data/berakhot.json (the app's bundle).

Mishnayos without a gloss file fall back to the mechanical chunks with empty meanings.
"""
import json, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
src = json.loads((root / "data/chunks.json").read_text())
gloss = {}
for f in (root / "data/gloss").glob("perek_*.json"):
    for m in json.loads(f.read_text()):
        gloss[(m["perek"], m["mishnah"])] = m
out = []
for r in src:
    g = gloss.get((r["perek"], r["mishnah"]))
    if g:
        keep = ("he", "en", "explain", "st", "stMore", "basis", "basisNote")
        chunks = [{**{k: c[k] for k in keep if c.get(k)},
                   "words": [{k: v for k, v in w.items() if k in ("he", "en", "note") and v} for w in c["words"]]}
                  for c in g["chunks"]]
        summary = g["summary"]
        st_intro = g.get("stIntro", "")
    else:
        chunks = [{"he": c, "en": "", "words": [{"he": w, "en": ""} for w in c.split()]} for c in r["chunks"]]
        summary = ""
        st_intro = ""
    out.append({"perek": r["perek"], "mishnah": r["mishnah"], "summary": summary,
                "chunks": chunks, **({"stIntro": st_intro} if st_intro else {})})
dest = root / "src/data/berakhot.json"
dest.parent.mkdir(parents=True, exist_ok=True)
dest.write_text(json.dumps({"masechta": "ברכות", "masechtaEn": "Berakhot", "mishnayos": out}, ensure_ascii=False))
print(f"wrote {dest} ({len(out)} mishnayos, {len(gloss)} glossed)")
