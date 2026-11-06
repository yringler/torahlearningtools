/**
 * The ONLY writer of perek_verifications (docs/PARENT_VERIFICATION.md §11). /api/sync never touches the table, and no
 * caller passes a value that came from a client.
 *
 * Callers today: the confirm route (token-keyed form). The keyed form is the seam for the later parent-only admin:
 * - verified: false (un-verify) only removes access, so it may sit behind that admin's own login;
 * - verified: true must stay behind proof that the parent tested the child. In this app that proof is the emailed
 *   link, so never wire it to an endpoint a child can reach (the parent area's hold gate is not proof).
 */

export interface SetVerification {
  userId: string;
  childId: string;
  masechta: string;
  perek: number;
  verified: boolean;
  source: "email" | "admin";
  testId: string | null;
  t: number;
}

/** Keyed form: rev bump + upsert at that rev + settle the child's live links for this perek. */
export function setVerificationStmts(db: D1Database, a: SetVerification): D1PreparedStatement[] {
  const live = "EXISTS (SELECT 1 FROM children c WHERE c.id = ?2 AND c.user_id = ?1 AND c.deleted = 0)";
  return [
    db.prepare(`UPDATE users SET rev = rev + 1 WHERE id = ?1 AND ${live}`).bind(a.userId, a.childId),
    db
      .prepare(
        `INSERT INTO perek_verifications (child_id, user_id, masechta, perek, verified, verified_at, source, test_id, updated_at, rev)
         SELECT ?2, ?1, ?3, ?4, ?5, CASE WHEN ?5 = 1 THEN ?8 END, ?6, ?7, ?8, u.rev FROM users u
         WHERE u.id = ?1 AND ${live}
         ON CONFLICT (child_id, masechta, perek) DO UPDATE SET
           verified = excluded.verified,
           -- when it last became 1: kept while it stays 1, and kept (for history) when it goes to 0
           verified_at = CASE WHEN excluded.verified = 1 AND perek_verifications.verified = 0 THEN excluded.verified_at
                              ELSE perek_verifications.verified_at END,
           source = excluded.source, test_id = excluded.test_id, updated_at = excluded.updated_at, rev = excluded.rev`,
      )
      .bind(a.userId, a.childId, a.masechta, a.perek, a.verified ? 1 : 0, a.source, a.testId, a.t),
    // verified: other live links are moot. Un-verified: revoke them, so an old email can't silently re-verify.
    db
      .prepare(
        `UPDATE perek_tests SET consumed_at = ?5, outcome = ?6
         WHERE user_id = ?1 AND child_id = ?2 AND masechta = ?3 AND perek = ?4 AND consumed_at IS NULL`,
      )
      .bind(a.userId, a.childId, a.masechta, a.perek, a.t, a.verified ? "covered" : "revoked"),
  ];
}

/**
 * Token-keyed form for POST /api/perek-tests/confirm (§5.3). One db.batch, so nothing is read between statements:
 * every later statement finds "this call's" row by `consumed_at = t AND outcome = 'verified'`.
 * Two confirms of different links in the same millisecond could both match and bump rev twice; that is harmless.
 */
export function confirmTokenStmts(db: D1Database, tokenHash: string, t: number): D1PreparedStatement[] {
  const mine = "token_hash = ?1 AND consumed_at = ?2 AND outcome = 'verified'";
  return [
    // 1. consume: only a live, pending token of a live child
    db
      .prepare(
        `UPDATE perek_tests SET consumed_at = ?2, outcome = 'verified'
         WHERE token_hash = ?1 AND consumed_at IS NULL AND expires_at > ?2
           AND EXISTS (SELECT 1 FROM children c WHERE c.id = perek_tests.child_id AND c.deleted = 0)`,
      )
      .bind(tokenHash, t),
    // 2. bump the account revision so every device pulls the change
    db.prepare(`UPDATE users SET rev = rev + 1 WHERE id = (SELECT user_id FROM perek_tests WHERE ${mine})`).bind(tokenHash, t),
    // 3. upsert the verification at that rev
    db
      .prepare(
        `INSERT INTO perek_verifications (child_id, user_id, masechta, perek, verified, verified_at, source, test_id, updated_at, rev)
         SELECT pt.child_id, pt.user_id, pt.masechta, pt.perek, 1, ?2, 'email', pt.id, ?2, u.rev
         FROM perek_tests pt JOIN users u ON u.id = pt.user_id
         WHERE pt.token_hash = ?1 AND pt.consumed_at = ?2 AND pt.outcome = 'verified'
         ON CONFLICT (child_id, masechta, perek) DO UPDATE SET
           verified = 1, verified_at = excluded.verified_at, source = 'email', test_id = excluded.test_id,
           updated_at = excluded.updated_at, rev = excluded.rev
         WHERE perek_verifications.verified = 0`,
      )
      .bind(tokenHash, t),
    // 4. other live links for the same perek are now moot (only for this call's consume, so re-confirming an old
    //    link never touches links sent after a later un-verify)
    db
      .prepare(
        `UPDATE perek_tests SET consumed_at = ?2, outcome = 'covered'
         WHERE consumed_at IS NULL AND (child_id, masechta, perek) =
           (SELECT child_id, masechta, perek FROM perek_tests WHERE ${mine})`,
      )
      .bind(tokenHash, t),
  ];
}
