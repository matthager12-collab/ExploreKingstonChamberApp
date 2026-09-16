#!/bin/sh
# One-shot Neon -> Render Postgres copy (2026-09-02 cutover). Runs as the CMD
# of ops/db-copy/Dockerfile from the db-copy-neon-to-render-v2 cron in
# render.yaml; see that block for why it is an image and not a dockerCommand.
#
# SOURCE_URL  the web service's DATABASE_URL (Neon pooled URL, via fromService)
# TARGET_URL  explore-kingston-db's internal URL (via fromDatabase)
# Refuses unless the source host is *.neon.tech and differs from the target.
set -eu
set -f
set -o pipefail 2>/dev/null || true
SRC=$(printf %s $SOURCE_URL | sed 's/-pooler\././')
case $SRC in
  *.neon.tech*) ;;
  *) echo SOURCE_URL is not a Neon host, refusing; exit 1;;
esac
[ $SRC != $TARGET_URL ] || { echo source equals target, refusing; exit 1; }
echo copy: start
pg_dump --no-owner --no-privileges -Fc $SRC | pg_restore --no-owner --no-privileges --clean --if-exists --single-transaction -d $TARGET_URL
echo copy: restored
for u in $SRC $TARGET_URL; do
  echo ===
  psql $u -At <<'SQL'
select 'collation ' || datcollate || ' ' || datctype from pg_database where datname = current_database();
select table_schema || '.' || table_name || ' ' || (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text from information_schema.tables where table_schema in ('public', 'drizzle') and table_type = 'BASE TABLE' order by 1;
SQL
done
echo copy: done
