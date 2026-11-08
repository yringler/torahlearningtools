"""Fetch one masechta (Hebrew + its translation sources) from the Sefaria API into data/<id>/raw/perek_N.json.

Usage: python3 scripts/fetch_sefaria.py <masechta id> [--keep]
  --keep   skip perakim whose raw file already exists (to resume after Sefaria errors)

The masechta, its Sefaria book name and its sources come from data/catalog.json. The number of perakim (and the total
number of mishnayos, as a check) comes from Sefaria's index API. A version that Sefaria doesn't return stops the
script: nothing is silently written as [].

Only established, published translations are used as sources for the children's meanings:
  steinsaltz  - William Davidson Edition (Koren Noé, R. Adin Even-Israel Steinsaltz): bold = translation, plain = explanation
  bartenura   - The Mishna with Obadiah Bartenura, tr. R. Shraga Silverstein: translation with Bartenura's explanation in [brackets]
Deliberately not used: "Open Mishnah" (community/Wikisource translation); Mishnah Yomit (Kulp, non-traditional
source); Eighteen Treatises (De Sola & Raphall) only covers perek 1 of Berakhot on Sefaria.
A masechta with no acceptable translation has sources [] and is fetched (and shipped) in Hebrew only.
"""
import json, sys, time, urllib.error, urllib.parse, urllib.request

sys.dont_write_bytecode = True  # keep scripts/__pycache__ out of the repo
import catalog  # noqa: E402

TRIES = 5          # per request; waits 2, 4, 8, 16, 32 s between tries (Sefaria often answers 503/504)


def get_json(url: str):
    for attempt in range(TRIES):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                return json.load(r)
        except (urllib.error.URLError, TimeoutError, ConnectionError, json.JSONDecodeError) as e:
            if isinstance(e, urllib.error.HTTPError) and e.code < 500 and e.code != 429:
                raise SystemExit(f"{url}: HTTP {e.code}")
            if attempt == TRIES - 1:
                raise SystemExit(f"{url}: giving up after {TRIES} tries ({e})")
            wait = 2 ** (attempt + 1)
            print(f"  {e}; retrying in {wait}s", file=sys.stderr)
            time.sleep(wait)


def get_text(ref: str, version: str, required: bool = True) -> list:
    """One perek of one version. Hebrew and excerpt sources (Steinsaltz) must be there; another translation may skip a
    perek (written as [], and chunk.py fills its mishnayos with ""), which is printed so it isn't missed."""
    d = get_json(f"https://www.sefaria.org/api/v3/texts/{ref}?version={urllib.parse.quote(version)}")
    vs = d.get("versions") or []
    text = vs[0].get("text") if vs else None
    if not isinstance(text, list) or not any(isinstance(t, str) and t.strip() for t in text):
        msg = f"{ref}: Sefaria returned no text for version {version!r} {d.get('warnings') or ''}"
        if required:
            raise SystemExit(msg)
        print(f"  warning: {msg}; written as []", file=sys.stderr)
        return []
    return text


def main():
    m = catalog.from_argv("fetch_sefaria.py <masechta id> [--keep]")
    keep = "--keep" in sys.argv[2:]
    index = get_json(f"https://www.sefaria.org/api/v2/raw/index/{m['sefaria']}")
    perakim, total = index["schema"]["lengths"][:2]
    if m.get("perakim"):
        # The catalog ships fewer perakim than Sefaria's index lists (Bikkurim's perek 4 isn't in Torat Emet).
        perakim, total = m["perakim"], None
    versions = {"he": catalog.CATALOG["hebrew"]["version"], **{s: catalog.SOURCES[s]["version"] for s in m["sources"]}}
    out = catalog.raw_dir(m["id"])
    out.mkdir(parents=True, exist_ok=True)
    count = 0
    for perek in range(1, perakim + 1):
        path = out / f"perek_{perek}.json"
        if keep and path.exists():
            data = json.loads(path.read_text())
        else:
            data = {k: get_text(f"{m['sefaria']}.{perek}", v, required=k == "he" or bool(catalog.SOURCES.get(k, {}).get("excerpts")))
                    for k, v in versions.items()}
            path.write_text(json.dumps(data, ensure_ascii=False, indent=1))
        count += len(data["he"])
        print(m["id"], perek, {k: len(x) for k, x in data.items()})
    if total is not None and count != total:
        raise SystemExit(f"{m['id']}: fetched {count} mishnayos but Sefaria's index says {total}")
    print(f"{m['id']}: {perakim} perakim, {count} mishnayos")


main()
