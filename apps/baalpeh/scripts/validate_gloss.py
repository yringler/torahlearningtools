"""Validate an LLM-produced gloss file against data/chunks.json.

Usage: python3 scripts/validate_gloss.py data/gloss/perek_N.json [...]
Checks: every mishnah of the perek present; chunk Hebrew words, joined, equal the
source words exactly; each chunk's words[] match the chunk's words exactly;
required fields non-empty; chunks are 1-7 words.
"""
import json, re, sys, pathlib

TAG = re.compile(r"</?b>")

def bold_mask(html: str, where: str) -> list[tuple[str, bool]]:
    """(char, is_bold) for every non-space char; tags must be balanced and un-nested."""
    out, bold = [], False
    for tok in re.split(r"(</?b>)", html):
        if tok == "<b>":
            if bold: err(f"{where}: nested <b>")
            bold = True
        elif tok == "</b>":
            if not bold: err(f"{where}: stray </b>")
            bold = False
        else:
            out.extend((c, bold) for c in tok if not c.isspace())
    if bold: err(f"{where}: unclosed <b>")
    return out

BASIS = {"steinsaltz", "bartenura"}

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
        # Steinsaltz excerpts: intro + every chunk's st/stMore must reproduce the source exactly (text + bold).
        pieces = [m.get("stIntro", "")] + [x for c in m["chunks"] for x in (c.get("st", ""), c.get("stMore", ""))]
        got_mask = [cb for i, p in enumerate(pieces) for cb in bold_mask(p, f"{k} piece {i}")]
        want_mask = bold_mask(s["steinsaltz"], f"{k} source")
        if got_mask != want_mask:
            i = next((i for i, (a, b) in enumerate(zip(got_mask, want_mask)) if a != b), min(len(got_mask), len(want_mask)))
            ctx = "".join(c for c, _ in want_mask[max(0, i - 25):i + 15])
            err(f"{k}: Steinsaltz excerpts diverge at char {i} (text or bold), source context: …{ctx}…")
        for j, c in enumerate(m["chunks"]):
            if not TAG.sub("", c.get("st", "")).strip(): err(f"{k} chunk {j}: empty st")
            b = c.get("basis")
            if not isinstance(b, list) or not b or not set(b) <= BASIS: err(f"{k} chunk {j}: basis must be a non-empty subset of {BASIS}")
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
