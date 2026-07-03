-- Explore Kingston — production database schema (Neon Postgres).
-- Run once against the Neon database (Neon SQL editor, or `psql "$DATABASE_URL" -f db/schema.sql`).
-- The app also self-initializes these lazily via ensureSchema() in src/lib/db.ts;
-- this file is the canonical reference and a manual setup path.

-- Generic overlay table: backs every portal-editable collection (restaurants,
-- events, charities, volunteer-needs, parking-zones, map views) AND auth
-- (store = 'auth-users' / 'auth-invites'). Custom-wins-by-id over the git seed
-- arrays; the JS layer (readMerged) does the seed+overlay merge. The `deleted`
-- column carries the { _deleted:true } tombstones that hide seed rows.
CREATE TABLE IF NOT EXISTS overlay (
  store   text NOT NULL,
  id      text NOT NULL,
  doc     jsonb NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  PRIMARY KEY (store, id)
);

-- Append-only analytics events (pageviews, outbound clicks, opt-in geo-pings).
-- summarize() scans all rows; add an index on ts only when date-ranged reports
-- are needed.
CREATE TABLE IF NOT EXISTS analytics_event (
  ts    timestamptz NOT NULL DEFAULT now(),
  event jsonb NOT NULL
);

-- Append-only anonymous LTAC survey responses.
CREATE TABLE IF NOT EXISTS survey_response (
  ts       timestamptz NOT NULL DEFAULT now(),
  response jsonb NOT NULL
);
