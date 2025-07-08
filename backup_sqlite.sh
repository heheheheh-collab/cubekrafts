#!/bin/bash
# Backup script for SQLite DB
date=$(date +"%Y-%m-%d_%H-%M-%S")
DB_PATH="$(dirname "$0")/prisma/dev.db"
BACKUP_DIR="$(dirname "$0")/backups"
mkdir -p "$BACKUP_DIR"
cp "$DB_PATH" "$BACKUP_DIR/dev_$date.db"
echo "Backup created at $BACKUP_DIR/dev_$date.db" 