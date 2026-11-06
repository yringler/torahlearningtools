"""Merge data/chunks.json + data/gloss/perek_*.json into the app's data files.

Writes:
  public/data/m/<id>.<hash>.json   one file per masechta, fetched by the app when it is opened and kept offline by the
                                   service worker. The content hash in the name lets it be cached forever.
  src/data/index.json              the small catalog bundled into the app: each masechta's names, perek sizes and file.
  worker/data/text.json            the Hebrew pieces (chunk.he) of every perek, for the Worker's perek-test email and
                                   landing page (docs/PARENT_VERIFICATION.md §6.1). Exactly the pieces the app shows.

Mishnayos without a gloss file fall back to the mechanical chunks with empty meanings.
data/hide.json drops Steinsaltz text from listed mishnayos and rewords listed lines/word glosses (child-suitability);
the gloss files keep the originals. A rule that no longer matches the gloss stops the build.
"""
import hashlib, json, pathlib, re

root = pathlib.Path(__file__).resolve().parent.parent
MASECHTOS = [
    # id, Hebrew name, Sefaria name, mechanical chunks, gloss directory
    ("berakhot", "ברכות", "Berakhot", root / "data/chunks.json", root / "data/gloss"),
]
out_dir = root / "public/data/m"
index_path = root / "src/data/index.json"
text_path = root / "worker/data/text.json"
hide = json.loads((root / "data/hide.json").read_text())
hide_st = {k for k in hide["hideSteinsaltz"] if not k.startswith("_")}


def letters(he):
    """Hebrew letters only: nikud order differs between sources, so word rules match on the letters."""
    return re.sub(r"[^\u05d0-\u05ea]", "", he)


def apply_hide(gloss):
    """Apply data/hide.json to the gloss in place. Fails loudly if a rule names something that isn't there."""
    for ref in hide_st:
        p, n = map(int, ref.split(":"))
        m = gloss.get((p, n))
        if not m:
            raise SystemExit(f"hide.json: hideSteinsaltz {ref} has no gloss")
        m.pop("stIntro", None)
        for c in m["chunks"]:
            c.pop("st", None)
            c.pop("stMore", None)
    for r in hide["override"]:
        p, n = map(int, r["ref"].split(":"))
        m = gloss.get((p, n))
        chunks = m["chunks"] if m else []
        if not 1 <= r["piece"] <= len(chunks):
            raise SystemExit(f"hide.json: {r['ref']} piece {r['piece']} not found")
        target = chunks[r["piece"] - 1]
        if "word" in r:
            hits = [w for w in target["words"] if letters(w["he"]) == letters(r["word"])]
            if len(hits) != 1:
                raise SystemExit(f"hide.json: {r['ref']} piece {r['piece']} word {r['word']!r} matched {len(hits)} words")
            target = hits[0]
        for k, v in r["set"].items():
            if k not in target:
                raise SystemExit(f"hide.json: {r['ref']} piece {r['piece']} has no {k!r} to override")
            target[k] = v


def build(he_name, en_name, chunks_path, gloss_dir):
    src = json.loads(chunks_path.read_text())
    gloss = {}
    for f in gloss_dir.glob("perek_*.json"):
        for m in json.loads(f.read_text()):
            gloss[(m["perek"], m["mishnah"])] = m
    apply_hide(gloss)
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
texts = {}
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
    perakim = {}
    for m in data["mishnayos"]:
        perakim.setdefault(str(m["perek"]), []).append([c["he"] for c in m["chunks"]])
    texts[mid] = {"source": f"/data/m/{name}", "he": he_name, "en": en_name, "perakim": perakim}
    print(f"wrote {out_dir / name} ({len(data['mishnayos'])} mishnayos, {glossed} glossed)")

index_path.parent.mkdir(parents=True, exist_ok=True)
lines = ",\n".join("  " + json.dumps(e, ensure_ascii=False) for e in entries)  # one masechta per line
index_path.write_text('{"masechtos": [\n' + lines + "\n]}\n")
print(f"wrote {index_path}")

text_path.parent.mkdir(parents=True, exist_ok=True)
lines = ",\n".join("  " + json.dumps(k, ensure_ascii=False) + ": " + json.dumps(v, ensure_ascii=False) for k, v in texts.items())
text_path.write_text("{\n" + lines + "\n}\n")
print(f"wrote {text_path}")
