import { describe, expect, it } from "vitest";
import { cleanup } from "../cron";
import { db } from "./helpers";

const DAY = 86_400_000;

describe("cleanup", () => {
  it("deletes expired rows and keeps live ones", async () => {
    const now = Date.now();
    const uid = crypto.randomUUID();
    const tag = crypto.randomUUID();
    await db.batch([
      db.prepare("INSERT INTO users (id, email, created_at, rev) VALUES (?, ?, ?, 0)").bind(uid, `${tag}@example.com`, now),
      db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)").bind(`old-${tag}`, uid, now, now, now - 1),
      db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)").bind(`live-${tag}`, uid, now, now, now + DAY),
      db.prepare("INSERT INTO login_requests (id, email, token_hash, code_hash, created_at, expires_at) VALUES (?, ?, ?, 'x', ?, ?)").bind(`lr-old-${tag}`, "a@b.cd", `t-old-${tag}`, now, now - 2 * DAY),
      db.prepare("INSERT INTO login_requests (id, email, token_hash, code_hash, created_at, expires_at) VALUES (?, ?, ?, 'x', ?, ?)").bind(`lr-recent-${tag}`, "a@b.cd", `t-recent-${tag}`, now, now - 60_000),
      db.prepare("INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)").bind(`rl-old-${tag}`, now - 2 * DAY),
      db.prepare("INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)").bind(`rl-live-${tag}`, now),
    ]);
    await cleanup({ DB: db }, now);
    const has = async (sql: string, v: string) => (await db.prepare(sql).bind(v).first()) !== null;
    expect(await has("SELECT 1 FROM sessions WHERE token_hash = ?", `old-${tag}`)).toBe(false);
    expect(await has("SELECT 1 FROM sessions WHERE token_hash = ?", `live-${tag}`)).toBe(true);
    expect(await has("SELECT 1 FROM login_requests WHERE id = ?", `lr-old-${tag}`)).toBe(false);
    expect(await has("SELECT 1 FROM login_requests WHERE id = ?", `lr-recent-${tag}`)).toBe(true);
    expect(await has("SELECT 1 FROM rate_limits WHERE key = ?", `rl-old-${tag}`)).toBe(false);
    expect(await has("SELECT 1 FROM rate_limits WHERE key = ?", `rl-live-${tag}`)).toBe(true);
  });
});
