-- Multi-masechta practice log (docs/SERVER_PLAN.md §8.1). The catalog id of the event's masechta, copied from the
-- event JSON. NULL means Berakhot (every event written before this column, and events from older clients).
-- No backfill.
ALTER TABLE events ADD COLUMN masechta TEXT;
