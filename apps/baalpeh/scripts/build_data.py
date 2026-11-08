"""Build the app's data files from every masechta in data/catalog.json.

Usage: python3 scripts/build_data.py   (or `npm run data`)

Writes:
  public/data/m/<id>.<hash>.json   one file per masechta, fetched by the app when it is opened and kept offline by the
                                   service worker. The content hash in the name lets it be cached forever. Files of
                                   older versions, and of ids no longer in the catalog, are deleted.
  src/data/index.json              the small catalog bundled into the app: sedarim, and in each its masechtos' names,
                                   perek sizes, file and whether they have meanings (`translated`).
  worker/data/text.json            the Hebrew pieces (chunk.he) of every perek, for the Worker's perek-test email and
                                   landing page (docs/PARENT_VERIFICATION.md §6.1). Exactly the pieces the app shows.

A masechta with translation sources is built from data/<id>/gloss/perek_*.json and must be fully glossed, or the build
fails. data/<id>/hide.json (optional) drops Steinsaltz text from listed mishnayos and rewords listed lines/word glosses
(child-suitability); the gloss files keep the originals. A rule that no longer matches the gloss stops the build.
A Hebrew-only masechta (sources: []) is built from the mechanical chunks in data/<id>/chunks.json, with an empty
summary and empty meanings (`en: ""`) on every piece and word, in the same shape as a glossed masechta.
"""
import hashlib, json, re, sys

sys.dont_write_bytecode = True  # keep scripts/__pycache__ out of the repo
import catalog  # noqa: E402

root = catalog.ROOT
out_dir = root / "public/data/m"
index_path = root / "src/data/index.json"
text_path = root / "worker/data/text.json"


def letters(he):
    """Hebrew letters only: nikud order differs between sources, so word rules match on the letters."""
    return re.sub(r"[^א-ת]", "", he)


def apply_hide(mid, hide, gloss):
    """Apply data/<id>/hide.json to the gloss in place. Fails loudly if a rule names something that isn't there."""
    hide_st = {k for k in hide.get("hideSteinsaltz", {}) if not k.startswith("_")}
    for ref in hide_st:
        p, n = map(int, ref.split(":"))
        m = gloss.get((p, n))
        if not m:
            raise SystemExit(f"{mid}/hide.json: hideSteinsaltz {ref} has no gloss")
        m.pop("stIntro", None)
        for c in m["chunks"]:
            c.pop("st", None)
            c.pop("stMore", None)
    for r in hide.get("override", []):
        p, n = map(int, r["ref"].split(":"))
        m = gloss.get((p, n))
        chunks = m["chunks"] if m else []
        if not 1 <= r["piece"] <= len(chunks):
            raise SystemExit(f"{mid}/hide.json: {r['ref']} piece {r['piece']} not found")
        target = chunks[r["piece"] - 1]
        if "word" in r:
            hits = [w for w in target["words"] if letters(w["he"]) == letters(r["word"])]
            if len(hits) != 1:
                raise SystemExit(f"{mid}/hide.json: {r['ref']} piece {r['piece']} word {r['word']!r} matched {len(hits)} words")
            target = hits[0]
        for k, v in r["set"].items():
            if k not in target:
                raise SystemExit(f"{mid}/hide.json: {r['ref']} piece {r['piece']} has no {k!r} to override")
            target[k] = v


def load_gloss(entry, src):
    """The masechta's gloss by (perek, mishnah), with hide.json applied. {} for a Hebrew-only masechta."""
    mid = entry["id"]
    hide_file = catalog.hide_path(mid)
    hide = json.loads(hide_file.read_text()) if hide_file.exists() else {}
    if not entry["sources"]:
        if hide.get("override") or [k for k in hide.get("hideSteinsaltz", {}) if not k.startswith("_")]:
            raise SystemExit(f"{mid}/hide.json: {mid} is Hebrew only, so there are no meanings to hide")
        return {}
    gloss = {}
    for f in catalog.perek_files(catalog.gloss_dir(mid)):
        for m in json.loads(f.read_text()):
            gloss[(m["perek"], m["mishnah"])] = m
    missing = [f"{p}:{n}" for p, n in ((r["perek"], r["mishnah"]) for r in src) if (p, n) not in gloss]
    if missing:
        raise SystemExit(f"{mid} has translation sources but no gloss for {', '.join(missing[:10])}"
                         f"{' …' if len(missing) > 10 else ''}; gloss it (scripts/GLOSS_PROMPT.md) or set its sources to []")
    apply_hide(mid, hide, gloss)
    return gloss


def build(entry):
    src = json.loads(catalog.chunks_path(entry["id"]).read_text())
    gloss = load_gloss(entry, src)
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
    return {"masechta": entry["he"], "masechtaEn": entry["en"], "mishnayos": out}, len(gloss)


out_dir.mkdir(parents=True, exist_ok=True)
by_seder = {s["id"]: [] for s in catalog.CATALOG["sedarim"]}
texts = {}
written = set()
for entry in catalog.MASECHTOS:
    mid = entry["id"]
    data, glossed = build(entry)
    body = json.dumps(data, ensure_ascii=False).encode()
    name = f"{mid}.{hashlib.sha256(body).hexdigest()[:10]}.json"
    (out_dir / name).write_bytes(body)
    written.add(name)
    counts = {}
    for m in data["mishnayos"]:
        counts[m["perek"]] = counts.get(m["perek"], 0) + 1
    by_seder[entry["seder"]].append({
        "id": mid, "he": entry["he"], "en": entry["en"], "file": f"/data/m/{name}", "bytes": len(body),
        "perakim": [counts[p] for p in sorted(counts)], "translated": bool(entry["sources"])})
    perakim = {}
    for m in data["mishnayos"]:
        perakim.setdefault(str(m["perek"]), []).append([c["he"] for c in m["chunks"]])
    texts[mid] = {"source": f"/data/m/{name}", "he": entry["he"], "en": entry["en"], "perakim": perakim}
    print(f"wrote {out_dir / name} ({len(data['mishnayos'])} mishnayos, {glossed} glossed)")

# Older versions of each masechta, and masechtos no longer in the catalog.
for old in out_dir.glob("*.json"):
    if old.name not in written:
        old.unlink()
        print(f"deleted {old}")

index_path.parent.mkdir(parents=True, exist_ok=True)
sedarim = []
for s in catalog.CATALOG["sedarim"]:
    if not by_seder[s["id"]]:
        continue
    head = json.dumps({k: s[k] for k in ("id", "he", "en")}, ensure_ascii=False)[:-1]
    rows = ",\n".join("    " + json.dumps(e, ensure_ascii=False) for e in by_seder[s["id"]])  # one masechta per line
    sedarim.append(f'  {head}, "masechtos": [\n{rows}\n  ]}}')
index_path.write_text('{"sedarim": [\n' + ",\n".join(sedarim) + "\n]}\n")
print(f"wrote {index_path}")

text_path.parent.mkdir(parents=True, exist_ok=True)
lines = ",\n".join("  " + json.dumps(k, ensure_ascii=False) + ": " + json.dumps(v, ensure_ascii=False) for k, v in texts.items())
text_path.write_text("{\n" + lines + "\n}\n")
print(f"wrote {text_path}")
