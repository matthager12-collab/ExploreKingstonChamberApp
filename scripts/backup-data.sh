#!/bin/sh
# backup-data.sh — snapshot the persistent DATA_DIR for "Explore Kingston".
#
# Creates a timestamped tar.gz of the data volume (accounts, portal overlays,
# hunts + photos, analytics, survey, maps) and prunes snapshots older than a
# retention window. POSIX sh, no external deps beyond tar/gzip/find/date.
#
# Usage:
#   ./scripts/backup-data.sh                 # backs up /data -> /data/backups
#   DATA_DIR=/mnt/disk BACKUP_DIR=/mnt/backups ./scripts/backup-data.sh
#
# Make executable once:  chmod +x scripts/backup-data.sh
#
# Cron example (daily at 03:15, log to a file):
#   15 3 * * * DATA_DIR=/data BACKUP_DIR=/data/backups /app/scripts/backup-data.sh >> /var/log/kingston-backup.log 2>&1

set -eu

# Source directory to back up (matches DATA_DIR in the deploy configs).
DATA_DIR="${DATA_DIR:-/data}"

# Where snapshots are written. Defaults to a backups/ subdir of the data volume;
# override to send backups off the primary disk.
BACKUP_DIR="${BACKUP_DIR:-${DATA_DIR}/backups}"

# Days to keep. Older snapshots are pruned each run.
RETENTION_DAYS="${RETENTION_DAYS:-14}"

if [ ! -d "$DATA_DIR" ]; then
  echo "backup-data: DATA_DIR '$DATA_DIR' does not exist" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE="${BACKUP_DIR}/kingston-data-${STAMP}.tar.gz"

# Archive the CONTENTS of DATA_DIR (-C so paths are relative), excluding the
# backups dir itself so snapshots don't nest inside each other.
BACKUP_BASENAME="$(basename "$BACKUP_DIR")"
tar -czf "$ARCHIVE" -C "$DATA_DIR" --exclude="$BACKUP_BASENAME" . 2>/dev/null

echo "backup-data: wrote $ARCHIVE"

# Prune snapshots older than the retention window. -mtime +N is "older than
# N days"; the name glob keeps this from touching unrelated files.
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'kingston-data-*.tar.gz' \
  -mtime "+${RETENTION_DAYS}" -exec rm -f {} \;

echo "backup-data: pruned snapshots older than ${RETENTION_DAYS} days"
