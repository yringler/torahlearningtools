"""Validate an LLM-produced gloss file against data/chunks.json.

Usage: python3 scripts/validate_gloss.py data/gloss/perek_N.json [...]
Checks: every mishnah of the perek present; chunk Hebrew words, joined, equal the
source words exactly; each chunk's words[] match the chunk's words exactly;
required fields non-empty; chunks are 1-7 words.
"""
import json, sys, pathlib

src = {(r["perek"], r["mishnah"]): r for r in json.loads(pathlib.Path("data/chunks.json").read_text())}
ok = True
def err(msg: str):
    global ok; ok = False; print("ERROR", msg)

for path in sys.argv[1:]:
    data = json.loads(pathlib.Path(path).read_text())
    perakim = {m["perek"] for m in data}
    expected = {k for k in src if k[0] in perakim}
    got = {(m["perek"], m["mishnah"]) for m in data}
    for k in sorted(expected - got): err(f"{path}: missing mishnah {k}")
    for m in data:
        k = (m["perek"], m["mishnah"]); s = src.get(k)
        if not s: err(f"unknown mishnah {k}"); continue
        if not m.get("summary"): err(f"{k}: empty summary")
        want = " ".join(s["chunks"]).split()
        have = [w for c in m["chunks"] for w in c["he"].split()]
        if want != have:
            for i, (a, b) in enumerate(zip(want, have)):
                if a != b: err(f"{k}: word {i} differs: expected {a!r} got {b!r}"); break
            else: err(f"{k}: word count {len(have)} != {len(want)}")
        for j, c in enumerate(m["chunks"]):
            n = len(c["he"].split())
            if not 1 <= n <= 7: err(f"{k} chunk {j}: {n} words")
            if not c.get("en"): err(f"{k} chunk {j}: empty en")
            ws = [w["he"] for w in c.get("words", [])]
            if ws != c["he"].split(): err(f"{k} chunk {j}: words[] {ws} != chunk words")
            for w in c.get("words", []):
                if not w.get("en"): err(f"{k} chunk {j}: empty gloss for {w['he']}")
print("OK" if ok else "FAILED")
sys.exit(0 if ok else 1)
