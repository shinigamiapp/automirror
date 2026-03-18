#!/usr/bin/env bash
set -euo pipefail

: "${BACKUP_R2_BUCKET_NAME:?BACKUP_R2_BUCKET_NAME is required}"
RETENTION="${BACKUP_RETENTION_COUNT:-2}"

DATE=$(date -u +"%Y-%m-%d_%H%M%S")
echo "[$(date -u)] Starting R2 sync (retention: ${RETENTION})..."

shopt -s nullglob
files=(/var/backups/*)

if [ "${#files[@]}" -eq 0 ]; then
    echo "[$(date -u)] No backup files found in /var/backups — skipping."
    exit 0
fi

for filepath in "${files[@]}"; do
    [ -f "$filepath" ] || continue

    filename=$(basename "$filepath")
    # Strip all extensions to get the base name (e.g. scraper-worker-mysql)
    base="${filename%%.*}"
    # Preserve the full extension (e.g. .sql.gz or .sql)
    ext="${filename#"$base"}"
    dest="${base}_${DATE}${ext}"
    r2_prefix="databases/${base}"

    echo "[$(date -u)] Uploading '$filename' → '${r2_prefix}/$dest' ..."
    rclone copyto "$filepath" "r2:${BACKUP_R2_BUCKET_NAME}/${r2_prefix}/$dest"
    echo "[$(date -u)] Upload complete."

    # ── Retention: keep only the N most recent copies ────────────────────
    objects=$(rclone lsf "r2:${BACKUP_R2_BUCKET_NAME}/${r2_prefix}/" --files-only | sort)
    total=$(echo "$objects" | grep -c '.' || true)

    if [ "$total" -gt "$RETENTION" ]; then
        delete_count=$(( total - RETENTION ))
        echo "[$(date -u)] Pruning $delete_count old backup(s) for '$base'..."
        echo "$objects" | head -n "$delete_count" | while IFS= read -r key; do
            echo "[$(date -u)] Deleting: ${r2_prefix}/$key"
            rclone deletefile "r2:${BACKUP_R2_BUCKET_NAME}/${r2_prefix}/$key"
        done
    else
        echo "[$(date -u)] Retention OK ($total/${RETENTION} slots used)."
    fi
done

echo "[$(date -u)] R2 sync finished."
