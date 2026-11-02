import { HEBREW_SOURCE, type License, LICENSES_PATH, SOURCES } from "../sources";

const LicenseLink = ({ license }: { license: License }) => (
  <a href={license.url} target="_blank" rel="noreferrer license">{license.name}</a>
);

/** Small link to the sources & licenses page. Opens in a new tab so a learning session isn't interrupted. */
export function LicensesLink({ className = "link-btn" }: { className?: string }) {
  return <a className={className} href={LICENSES_PATH} target="_blank" rel="noreferrer">Sources &amp; licenses</a>;
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
  return (
    <div className="parent licenses" dir="ltr">
      <div className="topbar">
        <a className="btn ghost-btn small" href="/">‹ To the app</a>
        <span className="who">Sources &amp; licenses</span>
      </div>

      <section>
        <h3>Hebrew text</h3>
        <p>
          The Mishnah's Hebrew text with nikud is <a href={HEBREW_SOURCE.sefaria} target="_blank" rel="noreferrer">{HEBREW_SOURCE.name}</a>,
          via <a href="https://www.sefaria.org" target="_blank" rel="noreferrer">Sefaria</a>.
          License: <LicenseLink license={HEBREW_SOURCE.license} />.
        </p>
        <p className="hint">Changes: HTML markup removed, Unicode normalized, and each mishnah split into short pieces for memorizing.</p>
      </section>

      <section>
        <h3>Steinsaltz</h3>
        <p>
          English translation and explanation by R. Adin Even-Israel Steinsaltz, from <a href={st.sefaria} target="_blank" rel="noreferrer">The
          William Davidson digital edition of the Koren Noé Talmud</a> (Koren Publishers Jerusalem), via Sefaria.
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
          The Mishna with Obadiah Bartenura, translated by R. Shraga Silverstein, <a href={bt.sefaria} target="_blank" rel="noreferrer">via Sefaria</a>.
          License: <LicenseLink license={bt.license} />.
        </p>
        <p className="hint">
          Changes: not shown directly. It was used to check the "Simple" meanings and, in a few places, to fill in where
          Steinsaltz leaves a word untranslated. Each meaning's ⓘ says which sources it is based on.
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
