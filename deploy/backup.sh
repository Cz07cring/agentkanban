#!/bin/bash
# Agent Kanban - Automated Backup Script
# Usage: ./backup.sh [backup_dir]
# Recommended: Add to crontab: 0 */6 * * * /opt/agentkanban/main-repo/deploy/backup.sh

set -e

BACKUP_DIR="${1:-/opt/agentkanban/backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="$ROOT_DIR/backend/data"

mkdir -p "$BACKUP_DIR"

# Backup task data
if [ -f "$DATA_DIR/dev-tasks.json" ]; then
    cp "$DATA_DIR/dev-tasks.json" "$BACKUP_DIR/dev-tasks_${TIMESTAMP}.json"
    echo "[OK] Task data backed up: dev-tasks_${TIMESTAMP}.json"
fi

# Keep only last 30 backups
ls -t "$BACKUP_DIR"/dev-tasks_*.json 2>/dev/null | tail -n +31 | xargs rm -f 2>/dev/null || true

echo "[OK] Backup complete. Location: $BACKUP_DIR"
