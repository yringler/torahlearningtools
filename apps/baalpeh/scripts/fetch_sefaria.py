"""Fetch Mishnah Berakhot (Hebrew + English sources) from the Sefaria v3 API."""
import json, sys, urllib.request, urllib.parse, pathlib

BOOK = "Mishnah_Berakhot"
VERSIONS = {
    "he": "hebrew|Torat Emet 357",
    "steinsaltz": "english|William Davidson Edition - English",
    "kulp": "english|Mishnah Yomit by Dr. Joshua Kulp",
}
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "data/raw")
out.mkdir(parents=True, exist_ok=True)

def get(ref: str, version: str):
    url = f"https://www.sefaria.org/api/v3/texts/{ref}?version={urllib.parse.quote(version)}"
    with urllib.request.urlopen(url, timeout=30) as r:
        d = json.load(r)
    return d["versions"][0]["text"]

for perek in range(1, 10):
    data = {k: get(f"{BOOK}.{perek}", v) for k, v in VERSIONS.items()}
    (out / f"berakhot_{perek}.json").write_text(json.dumps(data, ensure_ascii=False, indent=1))
    print(perek, [len(x) for x in data.values()])
