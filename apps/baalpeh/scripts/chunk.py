"""Split each Hebrew mishnah into child-sized chunks (~2-6 words).

Rules:
1. Split after every . , : ; ? ! (punctuation stays attached to the chunk).
2. A clause longer than MAX words is split into near-equal pieces.
3. A 1-word clause is merged into its neighbour (prefer the following clause
   when the word ends with a comma introducing something, e.g. "אָמְרוּ לוֹ,").
"""
import json, re, sys, pathlib, math

MAX = 6
raw = pathlib.Path(sys.argv[1]); out = pathlib.Path(sys.argv[2])

def clean(t: str) -> str:
    t = re.sub(r"<[^>]+>", "", t)
    t = t.replace("־", "־")  # keep maqaf
    return re.sub(r"\s+", " ", t).strip()

def steinsaltz_markup(t: str) -> str:
    """Keep only <b>…</b> (Steinsaltz's translation); plain text is his explanation."""
    t = t.replace("<strong>", "<b>").replace("</strong>", "</b>").replace("<br>", " ")
    t = re.sub(r"<(?!/?b>)[^>]+>", "", t)
    t = re.sub(r"\s+", " ", t).strip()
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

result = []
for f in sorted(raw.glob("berakhot_*.json"), key=lambda p: int(p.stem.split("_")[1])):
    perek = int(f.stem.split("_")[1])
    d = json.loads(f.read_text())
    for m, he in enumerate(d["he"], 1):
        result.append({
            "perek": perek, "mishnah": m,
            "chunks": chunk(clean(he)),
            "steinsaltz": steinsaltz_markup(d["steinsaltz"][m - 1]),
            "bartenura": clean(d["bartenura"][m - 1]) if len(d["bartenura"]) >= m else "",
        })
out.write_text(json.dumps(result, ensure_ascii=False, indent=1))
lens = [len(c.split()) for r in result for c in r["chunks"]]
print(len(result), "mishnayos,", len(lens), "chunks, words/chunk max", max(lens), "avg", round(sum(lens)/len(lens),2))
print("chunks/mishnah:", sorted(len(r["chunks"]) for r in result))
