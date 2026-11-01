"""Fetch Mishnah Berakhot (Hebrew + English sources) from the Sefaria v3 API.

Only established, published translations are used as sources for the children's meanings:
  steinsaltz  - William Davidson Edition (Koren Noé, R. Adin Even-Israel Steinsaltz): bold = translation, plain = explanation
  bartenura   - The Mishna with Obadiah Bartenura, tr. R. Shraga Silverstein: translation with Bartenura's explanation in [brackets]
Deliberately not used: "Open Mishnah" (community/Wikisource translation); Mishnah Yomit (Kulp, non-traditional
source); Eighteen Treatises (De Sola & Raphall) only covers perek 1 of Berakhot on Sefaria.
"""
import json, sys, urllib.request, urllib.parse, pathlib

BOOK = "Mishnah_Berakhot"
VERSIONS = {
    "he": "hebrew|Torat Emet 357",
    "steinsaltz": "english|William Davidson Edition - English",
    "bartenura": "english|The Mishna with Obadiah Bartenura by Rabbi Shraga Silverstein",
}
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "data/raw")
out.mkdir(parents=True, exist_ok=True)

def get(ref: str, version: str):
    url = f"https://www.sefaria.org/api/v3/texts/{ref}?version={urllib.parse.quote(version)}"
    with urllib.request.urlopen(url, timeout=30) as r:
        d = json.load(r)
    vs = d.get("versions") or []
    return vs[0]["text"] if vs else []  # not every translation covers every perek

for perek in range(1, 10):
    data = {k: get(f"{BOOK}.{perek}", v) for k, v in VERSIONS.items()}
    (out / f"berakhot_{perek}.json").write_text(json.dumps(data, ensure_ascii=False, indent=1))
    print(perek, [len(x) for x in data.values()])
