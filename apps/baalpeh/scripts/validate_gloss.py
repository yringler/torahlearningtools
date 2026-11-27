"""Validate LLM-produced gloss files against data/<id>/chunks.json.

Usage: python3 scripts/validate_gloss.py <masechta id> [N ...]
  Checks data/<id>/gloss/perek_N.json for the perakim given, or every perek of the masechta when none are given
  (then a missing file is an error: a masechta with translation sources must be fully glossed to build).
Checks: every mishnah of the perek present; chunk Hebrew words, joined, equal the
source words exactly; each chunk's words[] match the chunk's words exactly;
required fields non-empty; chunks are 1-7 words; basis names only the masechta's sources;
when the masechta has an excerpts source (Steinsaltz), stIntro + st + stMore rebuild it exactly.
"""
import json, re, sys

sys.dont_write_bytecode = True  # keep scripts/__pycache__ out of the repo
import catalog  # noqa: E402

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

ok = True
def err(msg: str):
    global ok; ok = False; print("ERROR", msg)

M = catalog.from_argv("validate_gloss.py <masechta id> [N ...]")
if not M["sources"]:
    raise SystemExit(f"{M['id']} is Hebrew only (sources: []): there is nothing to gloss")
BASIS = set(M["sources"])
EXCERPTS = catalog.excerpts_source(M)
src = {(r["perek"], r["mishnah"]): r for r in json.loads(catalog.chunks_path(M["id"]).read_text())}
wanted = [int(a) for a in sys.argv[2:]] or sorted({p for p, _ in src})

for perek in wanted:
    path = catalog.gloss_dir(M["id"]) / f"perek_{perek}.json"
    if not path.exists():
        err(f"{path}: missing"); continue
    data = json.loads(path.read_text())
    perakim = {m["perek"] for m in data}
    if perakim != {perek}: err(f"{path}: holds perakim {sorted(perakim)}, expected only {perek}")
    expected = {k for k in src if k[0] == perek}
    got = {(m["perek"], m["mishnah"]) for m in data}
    for k in sorted(expected - got): err(f"{path}: missing mishnah {k}")
    for m in data:
        k = (m["perek"], m["mishnah"]); s = src.get(k)
        if not s: err(f"unknown mishnah {k}"); continue
        if not m.get("summary"): err(f"{k}: empty summary")
        if EXCERPTS:
            # Steinsaltz excerpts: intro + every chunk's st/stMore must reproduce the source exactly (text + bold).
            pieces = [m.get("stIntro", "")] + [x for c in m["chunks"] for x in (c.get("st", ""), c.get("stMore", ""))]
            got_mask = [cb for i, p in enumerate(pieces) for cb in bold_mask(p, f"{k} piece {i}")]
            want_mask = bold_mask(s[EXCERPTS], f"{k} source")
            if got_mask != want_mask:
                i = next((i for i, (a, b) in enumerate(zip(got_mask, want_mask)) if a != b), min(len(got_mask), len(want_mask)))
                ctx = "".join(c for c, _ in want_mask[max(0, i - 25):i + 15])
                err(f"{k}: Steinsaltz excerpts diverge at char {i} (text or bold), source context: …{ctx}…")
        elif m.get("stIntro") or any(c.get(f) for c in m["chunks"] for f in ("st", "stMore")):
            err(f"{k}: st/stMore/stIntro given, but {M['id']} has no excerpts source")
        for j, c in enumerate(m["chunks"]):
            if EXCERPTS and not TAG.sub("", c.get("st", "")).strip(): err(f"{k} chunk {j}: empty st")
            b = c.get("basis")
            if not isinstance(b, list) or not b or not set(b) <= BASIS: err(f"{k} chunk {j}: basis must be a non-empty subset of {sorted(BASIS)}")
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
