import { CATALOG, hasSource, type CatalogEntry } from "../data";
import { HEBREW_SOURCE, type License, LICENSES_PATH, SOURCES } from "../sources";

const LicenseLink = ({ license }: { license: License }) => (
  <a href={license.url} target="_blank" rel="noreferrer license">{license.name}</a>
);

/** "Berakhot, Peah and Demai", each linked to that masechta on Sefaria in the given version. */
const MasechtaLinks = ({ entries, url }: { entries: readonly CatalogEntry[]; url: (book: string) => string }) => (
  <>
    {entries.map((e, i) => (
      <span key={e.id}>
        {i > 0 && (i === entries.length - 1 ? " and " : ", ")}
        <a href={url(e.sefaria)} target="_blank" rel="noreferrer">{e.en}</a>
      </span>
    ))}
  </>
);

/** Small link to the sources & licenses page. Opens in a new tab so a learning session isn't interrupted. */
export function LicensesLink({ className = "link-btn" }: { className?: string }) {
  return <a className={className} href={LICENSES_PATH} target="_blank" rel="noreferrer">Sources &amp; licenses</a>;
}

export const PRIVACY_URL = "https://torahlearningtools.com/privacy";

/** Link to the privacy policy (Google Play requires one inside the app). New tab, like the licenses link. */
export function PrivacyLink({ className }: { className?: string }) {
  return <a className={className} href={PRIVACY_URL} target="_blank" rel="noreferrer">Privacy policy</a>;
}

/** Author credit, feedback address and privacy policy, shown at the bottom of each settings screen. */
export function AboutNote() {
  return (
    <section>
      <p className="hint">By Yehuda Ringler. Please send any feedback to <a href="mailto:admin@torahlearningtools.com">admin@torahlearningtools.com</a>.</p>
      <p className="hint"><PrivacyLink /></p>
    </section>
  );
}

/** The possible future pricing, said the same way everywhere it appears. */
export function PricingNote() {
  return (
    <p className="hint pricing-note">
      Accounts are free for now. Eventually, accounts may have a small yearly charge of about $5–10 per family.
      You'd be told well ahead of time, and learning without an account would stay free.
    </p>
  );
}

/** Attribution for every text the app shows, with the changes made to each (CC BY 3.0 §4(b), CC BY-NC 4.0 §3(a)). */
export function LicensesPage() {
  const st = SOURCES.steinsaltz;
  const bt = SOURCES.bartenura;
  // Each masechta's meanings come from the sources listed for it in data/catalog.json; Hebrew-only ones use none.
  const withSt = CATALOG.filter((e) => hasSource(e.id, "steinsaltz"));
  const withBt = CATALOG.filter((e) => hasSource(e.id, "bartenura"));
  const btOnly = withBt.filter((e) => !hasSource(e.id, "steinsaltz"));
  const hebrewOnly = CATALOG.filter((e) => !e.translated);
  return (
    <div className="parent licenses" dir="ltr">
      <div className="topbar">
        <a className="btn ghost-btn small" href="/">‹ To the app</a>
        <span className="who">Sources &amp; licenses</span>
      </div>

      <section>
        <h3>Hebrew text</h3>
        <p>
          The Mishnah's Hebrew text with nikud is {HEBREW_SOURCE.name}, via <a href="https://www.sefaria.org" target="_blank" rel="noreferrer">Sefaria</a>{" "}
          (<MasechtaLinks entries={CATALOG} url={HEBREW_SOURCE.sefaria} />).
          License: <LicenseLink license={HEBREW_SOURCE.license} />.
        </p>
        <p className="hint">Changes: HTML markup removed, Unicode normalized, and each mishnah split into short pieces for memorizing.</p>
        {hebrewOnly.length > 0 && (
          <p className="hint">
            <MasechtaLinks entries={hebrewOnly} url={HEBREW_SOURCE.sefaria} /> {hebrewOnly.length === 1 ? "has" : "have"} the
            Hebrew text only, with no English meanings.
          </p>
        )}
      </section>

      <section>
        <h3>Steinsaltz</h3>
        <p>
          English translation and explanation by R. Adin Even-Israel Steinsaltz, from The William Davidson digital
          edition of the Koren Noé Talmud (Koren Publishers Jerusalem), via Sefaria
          (<MasechtaLinks entries={withSt} url={st.sefaria} />).
          License: <LicenseLink license={st.license} />.
        </p>
        <p className="hint">
          Changes: the "Steinsaltz" view quotes the text word for word, but it's split to match the Hebrew pieces, HTML
          markup is removed, and longer explanations are hidden behind "more…". The "Simple" meanings and the
          tap-a-word meanings are adaptations: AI-written simplifications of Steinsaltz's translation, then checked. These
          adaptations are shared under the same <LicenseLink license={st.license} /> terms, so they may not be used commercially.
        </p>
      </section>

      <section>
        <h3>Bartenura</h3>
        <p>
          The Mishna with Obadiah Bartenura, translated by R. Shraga Silverstein, via Sefaria
          (<MasechtaLinks entries={withBt} url={bt.sefaria} />).
          License: <LicenseLink license={bt.license} />.
        </p>
        <p className="hint">
          Changes: not shown directly. Where a masechta also has Steinsaltz, it was used to check the "Simple" meanings
          and, in a few places, to fill in where Steinsaltz leaves a word untranslated.
          {btOnly.length > 0 && <> For <MasechtaLinks entries={btOnly} url={bt.sefaria} />, which have no Steinsaltz on
          Sefaria, the "Simple" and tap-a-word meanings are AI-written simplifications of this translation, then checked.</>}
          {" "}Each meaning's ⓘ says which sources it is based on.
        </p>
      </section>

      <section>
        <h3>No endorsement</h3>
        <p className="hint">
          This app isn't affiliated with or endorsed by Koren Publishers, Sefaria, the Steinsaltz Center or the
          translators. Mistakes in the simplified meanings are ours, not theirs. The texts are provided as-is, as their
          licenses state.
        </p>
      </section>

      <section>
        <h3>Price</h3>
        <PricingNote />
      </section>
    </div>
  );
}
