"""Split each Hebrew mishnah into child-sized chunks (~2-6 words).

Usage: python3 scripts/chunk.py <masechta id>    data/<id>/raw/perek_N.json -> data/<id>/chunks.json
Each mishnah also carries its sources' text (per data/catalog.json; none for a Hebrew-only masechta), for glossing.

Rules:
1. Split after every . , : ; ? ! (punctuation stays attached to the chunk).
2. A clause longer than MAX words is split into near-equal pieces.
3. A 1-word clause is merged into its neighbour (prefer the following clause
   when the word ends with a comma introducing something, e.g. "אָמְרוּ לוֹ,").
"""
import json, re, math, sys

sys.dont_write_bytecode = True  # keep scripts/__pycache__ out of the repo
import catalog  # noqa: E402

MAX = 6

def clean(t: str) -> str:
    t = re.sub(r"<[^>]+>", "", t)
    t = t.replace("־", "־")  # keep maqaf
    return re.sub(r"\s+", " ", t).strip()

def clean_he(t: str) -> str:
    """The Hebrew: drop the end-of-masechta colophon some files carry ("<br>סְלִיק מַסֶּכֶת …"), then clean()."""
    t = re.sub(r"<br>\s*סְלִיק\s.*$", "", t, flags=re.S)
    return clean(t.replace("<br>", " "))

def steinsaltz_markup(t: str) -> str:
    """Keep only <b>…</b> (Steinsaltz's translation); plain text is his explanation."""
    t = t.replace("<strong>", "<b>").replace("</strong>", "</b>").replace("<br>", " ")
    t = re.sub(r"<(?!/?b>)[^>]+>", "", t)
    # Flatten nested/stray bold tags (e.g. 9:1 has "<b>MISHNA:<b> … </b></b>").
    out, depth = [], 0
    for tok in re.split(r"(</?b>)", t):
        if tok == "<b>":
            if depth == 0: out.append(tok)
            depth += 1
        elif tok == "</b>":
            if depth == 1: out.append(tok)
            depth = max(0, depth - 1)
        else:
            out.append(tok)
    t = re.sub(r"\s+", " ", "".join(out)).strip()
    return t.replace("</b> <b>", " ").replace("<b></b>", "")

def clauses(text: str) -> list[list[str]]:
    parts = re.findall(r"[^.,:;?!]+[.,:;?!]*", text)
    return [p.split() for p in (x.strip() for x in parts) if p]

def split_long(ws: list[str]) -> list[list[str]]:
    if len(ws) <= MAX:
        return [ws]
    n = math.ceil(len(ws) / MAX)
    size = math.ceil(len(ws) / n)
    return [ws[i:i + size] for i in range(0, len(ws), size)]

def chunk(text: str) -> list[str]:
    cs: list[list[str]] = []
    for c in clauses(text):
        cs.extend(split_long(c))
    merged: list[list[str]] = []
    i = 0
    while i < len(cs):
        c = cs[i]
        if len(c) == 1:
            if i + 1 < len(cs) and len(c) + len(cs[i + 1]) <= MAX + 1:
                cs[i + 1] = c + cs[i + 1]; i += 1; continue
            if merged and len(merged[-1]) + 1 <= MAX + 1:
                merged[-1] = merged[-1] + c; i += 1; continue
        merged.append(c); i += 1
    return [" ".join(c) for c in merged]

def source_text(src: str, d: dict, n: int) -> str:
    """A source's text for mishnah n. Quoted (excerpts) sources must cover every mishnah; others may stop early."""
    if catalog.SOURCES[src].get("excerpts"):
        return steinsaltz_markup(d[src][n - 1])
    return clean(d[src][n - 1]) if len(d[src]) >= n else ""

m = catalog.from_argv("chunk.py <masechta id>")
out = catalog.chunks_path(m["id"])
result = []
for f in catalog.perek_files(catalog.raw_dir(m["id"])):
    perek = catalog.perek_of(f)
    d = json.loads(f.read_text())
    for n, he in enumerate(d["he"], 1):
        result.append({
            "perek": perek, "mishnah": n,
            "chunks": chunk(clean_he(he)),
            **{src: source_text(src, d, n) for src in m["sources"]},
        })
if not result:
    raise SystemExit(f"no raw files in {catalog.raw_dir(m['id'])}; run fetch_sefaria.py {m['id']} first")
out.write_text(json.dumps(result, ensure_ascii=False, indent=1))
lens = [len(c.split()) for r in result for c in r["chunks"]]
print(m["id"] + ":", len(result), "mishnayos,", len(lens), "chunks, words/chunk max", max(lens), "avg", round(sum(lens)/len(lens),2))
print("chunks/mishnah:", sorted(len(r["chunks"]) for r in result))
