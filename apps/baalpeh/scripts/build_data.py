"""Merge data/chunks.json + data/gloss/perek_*.json into the app's data files.

Writes:
  public/data/m/<id>.<hash>.json   one file per masechta, fetched by the app when it is opened and kept offline by the
                                   service worker. The content hash in the name lets it be cached forever.
  src/data/index.json              the small catalog bundled into the app: each masechta's names, perek sizes and file.

Mishnayos without a gloss file fall back to the mechanical chunks with empty meanings.
"""
import hashlib, json, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
MASECHTOS = [
    # id, Hebrew name, Sefaria name, mechanical chunks, gloss directory
    ("berakhot", "ברכות", "Berakhot", root / "data/chunks.json", root / "data/gloss"),
]
out_dir = root / "public/data/m"
index_path = root / "src/data/index.json"


def build(he_name, en_name, chunks_path, gloss_dir):
    src = json.loads(chunks_path.read_text())
    gloss = {}
    for f in gloss_dir.glob("perek_*.json"):
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
    return {"masechta": he_name, "masechtaEn": en_name, "mishnayos": out}, len(gloss)


out_dir.mkdir(parents=True, exist_ok=True)
entries = []
for mid, he_name, en_name, chunks_path, gloss_dir in MASECHTOS:
    data, glossed = build(he_name, en_name, chunks_path, gloss_dir)
    body = json.dumps(data, ensure_ascii=False).encode()
    name = f"{mid}.{hashlib.sha256(body).hexdigest()[:10]}.json"
    for old in out_dir.glob(f"{mid}.*.json"):
        if old.name != name:
            old.unlink()
    (out_dir / name).write_bytes(body)
    counts = {}
    for m in data["mishnayos"]:
        counts[m["perek"]] = counts.get(m["perek"], 0) + 1
    entries.append({"id": mid, "he": he_name, "en": en_name, "file": f"/data/m/{name}", "bytes": len(body),
                    "perakim": [counts[p] for p in sorted(counts)]})
    print(f"wrote {out_dir / name} ({len(data['mishnayos'])} mishnayos, {glossed} glossed)")

index_path.parent.mkdir(parents=True, exist_ok=True)
lines = ",\n".join("  " + json.dumps(e, ensure_ascii=False) for e in entries)  # one masechta per line
index_path.write_text('{"masechtos": [\n' + lines + "\n]}\n")
print(f"wrote {index_path}")
