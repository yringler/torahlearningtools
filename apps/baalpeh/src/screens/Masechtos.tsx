import { useEffect, useState } from "react";
import { isDownloaded, isMasechtaCached, SEDARIM } from "../data";
import { needsInternet, type MasechtaTile, type SederTile } from "../nav";
import type { Profile } from "../types";

/** Which masechtos open without the network: saved by the service worker, or already in memory. */
function useAvailable(ids: readonly string[]): ReadonlySet<string> {
  const [avail, setAvail] = useState<ReadonlySet<string>>(() => new Set(ids.filter(isMasechtaCached)));
  const key = ids.join(",");
  useEffect(() => {
    let cancelled = false;
    void Promise.all(ids.map(async (id) => [id, isMasechtaCached(id) || (await isDownloaded(id))] as const)).then((r) => {
      if (!cancelled) setAvail(new Set(r.filter(([, ok]) => ok).map(([id]) => id)));
    });
    return () => { cancelled = true; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return avail;
}

function TopBar({ profile, back, onBack }: { profile: Profile; back: string; onBack: () => void }) {
  return (
    <div className="topbar" dir="ltr">
      <button className="btn ghost-btn small" onClick={onBack}>{back}</button>
      <span className="who" style={{ color: profile.color }}>{profile.emoji} {profile.name}</span>
      <span />
    </div>
  );
}

const dueBadge = (due: number) => due > 0 && <span className="tile-due" dir="ltr">🔁 {due} due</span>;

/**
 * The masechtos of one seder, as tiles like the profile picker's: the Hebrew name large, the English name, how many
 * mishnayos are known, a due-review badge, the current masechta outlined in the child's colour, "Hebrew only" for a
 * masechta without meanings, and "needs internet" when offline and the masechta isn't saved on this device.
 */
export function MasechtaList({ profile, seder, tiles, online, onPick, onBack, onSedarim }: {
  profile: Profile;
  seder: string;
  tiles: MasechtaTile[];
  online: boolean;
  onPick: (id: string) => void;
  /** Back to the perek map. */
  onBack: () => void;
  /** "Choose a different seder". */
  onSedarim: () => void;
}) {
  const s = SEDARIM.find((x) => x.id === seder);
  const avail = useAvailable(tiles.map((t) => t.id));
  return (
    <div className="masechtos">
      <TopBar profile={profile} back="‹ Map" onBack={onBack} />
      <h2 className="masechta">סדר {s?.he ?? ""}</h2>
      <p className="hint center" dir="ltr">Choose a masechta</p>
      <div className="profile-grid">
        {tiles.map((t) => (
          <button
            key={t.id}
            className={`profile-tile masechta-tile${t.current ? " current" : ""}`}
            style={t.current ? { borderColor: profile.color } : undefined}
            aria-current={t.current ? "true" : undefined}
            aria-label={`Masechta ${t.en}, ${t.known} of ${t.total} known${t.due > 0 ? `, ${t.due} due` : ""}${t.translated ? "" : ", Hebrew only"}${t.current ? ", current" : ""}`}
            onClick={() => onPick(t.id)}
          >
            <span className="tile-he" dir="rtl" lang="he">מסכת {t.he}</span>
            <span className="sub" dir="ltr">{t.en}</span>
            <span className="tile-progress" dir="ltr">{t.finished ? "🏆 " : ""}{t.known}/{t.total} known</span>
            {dueBadge(t.due)}
            {!t.translated && <span className="chip" dir="ltr">Hebrew only</span>}
            {needsInternet(online, avail.has(t.id)) && <span className="sub" dir="ltr">needs internet</span>}
          </button>
        ))}
      </div>
      <div className="row center">
        <button className="btn ghost-btn" onClick={onSedarim}>Choose a different seder</button>
      </div>
    </div>
  );
}

/** The sedarim (only those in the catalog). */
export function SederList({ profile, tiles, onPick, onBack }: {
  profile: Profile;
  tiles: SederTile[];
  onPick: (seder: string) => void;
  /** Back to the masechta list. */
  onBack: () => void;
}) {
  return (
    <div className="masechtos">
      <TopBar profile={profile} back="‹ Masechtos" onBack={onBack} />
      <h2 className="masechta">ששה סדרי משנה</h2>
      <p className="hint center" dir="ltr">Choose a seder</p>
      <div className="profile-grid">
        {tiles.map((t) => (
          <button
            key={t.id}
            className={`profile-tile masechta-tile${t.current ? " current" : ""}`}
            style={t.current ? { borderColor: profile.color } : undefined}
            aria-current={t.current ? "true" : undefined}
            aria-label={`Seder ${t.en}, ${t.masechtos} masechtos, ${t.known} of ${t.total} known${t.due > 0 ? `, ${t.due} due` : ""}`}
            onClick={() => onPick(t.id)}
          >
            <span className="tile-he" dir="rtl" lang="he">סדר {t.he}</span>
            <span className="sub" dir="ltr">{t.en} · {t.masechtos} masechtos</span>
            <span className="tile-progress" dir="ltr">{t.known}/{t.total} known</span>
            {dueBadge(t.due)}
          </button>
        ))}
      </div>
      <p className="hint center" dir="ltr">More sedarim are on the way.</p>
    </div>
  );
}
