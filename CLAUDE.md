# pg-backup

Generic PostgreSQL database and directory backup tool with off-site sync.

## Status

**204 tests passing** (`bun test --randomize`)

## Features

- PostgreSQL database backup via pg_dump
- Directory backup via tar + gzip
- GPG symmetric encryption (AES-256)
- Off-site sync via rsync + SSH or S3-compatible storage
- Retention policy with automatic pruning
- Email alerts on success/failure
- Backup verification with checksum validation
- Easy restore with selective components

## CLI Commands

```bash
# Create backup
pg-backup backup

# List backups (local or remote)
pg-backup list [--remote]

# Restore from backup
pg-backup restore <backup-id> [--db-only] [--dirs-only]

# Verify backup integrity (checksums)
pg-backup verify <backup-id>

# Prune old backups (apply retention policy)
pg-backup prune [--dry-run]

# Show backup status
pg-backup status

# Common options
--backup-dir <path>   Override backup directory
--help                Show help
```

## Configuration

Via environment variables (prefix: `PG_BACKUP_`):

```bash
# Required: Database connection
PG_BACKUP_DB_NAME=production
PG_BACKUP_DB_HOST=localhost
PG_BACKUP_DB_PORT=5432
PG_BACKUP_DB_USER=postgres
# PG_BACKUP_DB_PASSWORD=your-password  # Or use .pgpass file

# Required: Local backup storage
PG_BACKUP_DIR=/var/lib/pg-backup/backups

# Optional: Directories to include (comma-separated)
PG_BACKUP_DIRECTORIES=/var/www/uploads,/etc/myapp

# Optional: GPG encryption
PG_BACKUP_ENCRYPTION_ENABLED=true
PG_BACKUP_ENCRYPTION_PASSPHRASE=your-secret-passphrase

# Optional: Retention policy
PG_BACKUP_RETENTION_DAYS=30    # Delete backups older than N days
PG_BACKUP_RETENTION_MIN_KEEP=7  # Always keep at least N backups

# Optional: S3-compatible off-site sync
PG_BACKUP_OFFSITE_TYPE=s3
PG_BACKUP_S3_BUCKET=my-backup-bucket
PG_BACKUP_S3_REGION=eu-central-1
PG_BACKUP_S3_ACCESS_KEY_ID=your-access-key
PG_BACKUP_S3_SECRET_ACCESS_KEY=your-secret-key
PG_BACKUP_S3_ENDPOINT=https://s3.eu-central-1.amazonaws.com
# Works with AWS S3, Backblaze B2, MinIO, R2, DigitalOcean Spaces, etc.

# Optional: Rsync/SSH off-site sync
PG_BACKUP_OFFSITE_TYPE=rsync
PG_BACKUP_RSYNC_HOST=backup-server.example.com
PG_BACKUP_RSYNC_USER=backup
PG_BACKUP_RSYNC_PATH=/backups/postgres
PG_BACKUP_RSYNC_SSH_KEY_PATH=/root/.ssh/backup_key

# Optional: Email alerts
PG_BACKUP_ALERT_SMTP_HOST=smtp.example.com
PG_BACKUP_ALERT_SMTP_PORT=587
PG_BACKUP_ALERT_SMTP_SECURE=false
PG_BACKUP_ALERT_SMTP_USER=alerts@example.com
PG_BACKUP_ALERT_SMTP_PASSWORD=your-smtp-password
PG_BACKUP_ALERT_FROM=backup@example.com
PG_BACKUP_ALERT_TO=admin@example.com,ops@example.com
PG_BACKUP_ALERT_SUBJECT_PREFIX=[PROD-BACKUP]
```

## Installation

```bash
# Clone and build
git clone https://github.com/jcfischer/pg-backup
cd pg-backup
bun install

# Run directly
bun run src/cli.ts backup

# Or build and install globally
bun build src/cli.ts --compile --outfile pg-backup
sudo cp pg-backup /usr/local/bin/
```

## Systemd Timer (Automated Daily Backups)

```bash
# Copy service and timer files
sudo cp systemd/pg-backup.service /etc/systemd/system/
sudo cp systemd/pg-backup.timer /etc/systemd/system/

# Create config directory and environment file
sudo mkdir -p /etc/pg-backup
sudo cp systemd/pg-backup.env.example /etc/pg-backup/pg-backup.env
sudo chmod 600 /etc/pg-backup/pg-backup.env
# Edit /etc/pg-backup/pg-backup.env with your settings

# Enable and start timer (runs daily at 03:00)
sudo systemctl daemon-reload
sudo systemctl enable --now pg-backup.timer

# Check timer status
systemctl list-timers pg-backup.timer

# Run backup manually
sudo systemctl start pg-backup.service
```

## Backup Structure

Each backup creates a directory with:
```
backup-2025-12-28T03-00-00/
├── manifest.json           # Backup metadata + checksums
├── mydb.sql.gz             # Database dump (or .sql.gz.gpg if encrypted)
├── uploads.tar.gz          # Directory archive (or .tar.gz.gpg if encrypted)
└── config.tar.gz           # Additional directories
```

## Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript
- **CLI**: Commander.js
- **Email**: Nodemailer
- **S3**: AWS SDK v3
- **System dependencies**: pg_dump, pg_restore, tar, gzip, gpg, rsync

## Testing

```bash
# Run all tests with randomized order
bun test --randomize

# Run specific test file
bun test tests/alerts.test.ts

# Watch mode
bun test --watch
```

## Project Structure

```
src/
├── cli.ts              # CLI entry point (Commander.js)
├── config.ts           # Configuration loading
├── types.ts            # TypeScript interfaces
├── database.ts         # pg_dump/pg_restore wrapper
├── directories.ts      # tar/gzip archiving
├── encryption.ts       # GPG symmetric encryption
├── manifest.ts         # Backup manifest with checksums
├── backup-service.ts   # Backup orchestrator
├── restore-service.ts  # Restore orchestrator
├── prune.ts            # Retention policy
├── verify.ts           # Checksum verification
├── alerts.ts           # Email notifications
├── offsite-s3.ts       # S3-compatible sync
└── offsite-rsync.ts    # rsync over SSH
```

## Deployment Guide

### Prerequisites

**On the target server:**

```bash
# PostgreSQL client tools (for pg_dump/pg_restore)
sudo apt install postgresql-client-16  # or your PostgreSQL version

# Archive tools
sudo apt install tar gzip

# Optional: GPG for encryption
sudo apt install gnupg

# Optional: rsync for off-site sync
sudo apt install rsync

# Bun runtime (for building)
curl -fsSL https://bun.sh/install | bash
```

### Step 1: Build the Binary

On your development machine or the server:

```bash
git clone https://github.com/jcfischer/pg-backup
cd pg-backup
bun install
bun build src/cli.ts --compile --outfile pg-backup

# Verify it works
./pg-backup --help
```

### Step 2: Install on Server

```bash
# Copy binary to system path
sudo cp pg-backup /usr/local/bin/
sudo chmod +x /usr/local/bin/pg-backup

# Verify installation
pg-backup --version
```

### Step 3: Create Backup Directory

```bash
# Create backup storage (owned by postgres user)
sudo mkdir -p /var/lib/pg-backup/backups
sudo chown postgres:postgres /var/lib/pg-backup/backups
sudo chmod 750 /var/lib/pg-backup/backups
```

### Step 4: Configure Environment

```bash
# Create config directory
sudo mkdir -p /etc/pg-backup
sudo chmod 700 /etc/pg-backup

# Copy and edit configuration
sudo cp systemd/pg-backup.env.example /etc/pg-backup/pg-backup.env
sudo chmod 600 /etc/pg-backup/pg-backup.env
sudo nano /etc/pg-backup/pg-backup.env
```

**Minimum configuration (`/etc/pg-backup/pg-backup.env`):**

```bash
# Database connection
PG_BACKUP_DB_NAME=your_database
PG_BACKUP_DB_HOST=localhost
PG_BACKUP_DB_PORT=5432
PG_BACKUP_DB_USER=postgres

# Backup storage
PG_BACKUP_DIR=/var/lib/pg-backup/backups

# Retention (keep 30 days, minimum 7 backups)
PG_BACKUP_RETENTION_DAYS=30
PG_BACKUP_RETENTION_MIN_KEEP=7
```

### Step 5: Test Manual Backup

```bash
# Load environment and run backup as postgres user
sudo -u postgres bash -c 'source /etc/pg-backup/pg-backup.env && pg-backup backup'

# Verify backup was created
sudo -u postgres pg-backup list --backup-dir /var/lib/pg-backup/backups

# Verify backup integrity
sudo -u postgres pg-backup verify <backup-id> --backup-dir /var/lib/pg-backup/backups
```

### Step 6: Install Systemd Service

```bash
# Copy systemd files
sudo cp systemd/pg-backup.service /etc/systemd/system/
sudo cp systemd/pg-backup.timer /etc/systemd/system/

# Reload systemd
sudo systemctl daemon-reload

# Enable timer (runs daily at 03:00)
sudo systemctl enable pg-backup.timer
sudo systemctl start pg-backup.timer

# Verify timer is scheduled
systemctl list-timers pg-backup.timer
```

### Step 7: Verify Automated Backup

```bash
# Check timer status
systemctl status pg-backup.timer

# Run backup manually via systemd
sudo systemctl start pg-backup.service

# Check service logs
journalctl -u pg-backup.service -f

# View recent backup logs
journalctl -u pg-backup.service --since "1 hour ago"
```

### Optional: Off-site Sync to S3

Add to `/etc/pg-backup/pg-backup.env`:

```bash
PG_BACKUP_OFFSITE_TYPE=s3
PG_BACKUP_S3_BUCKET=my-backup-bucket
PG_BACKUP_S3_REGION=eu-central-1
PG_BACKUP_S3_ACCESS_KEY_ID=AKIA...
PG_BACKUP_S3_SECRET_ACCESS_KEY=...
PG_BACKUP_S3_ENDPOINT=https://s3.eu-central-1.amazonaws.com
```

### Optional: Off-site Sync via Rsync/SSH

```bash
# Generate SSH key for backup user
sudo -u postgres ssh-keygen -t ed25519 -f /var/lib/postgresql/.ssh/backup_key -N ""

# Copy public key to backup server
sudo -u postgres ssh-copy-id -i /var/lib/postgresql/.ssh/backup_key.pub backup@backup-server.example.com
```

Add to `/etc/pg-backup/pg-backup.env`:

```bash
PG_BACKUP_OFFSITE_TYPE=rsync
PG_BACKUP_RSYNC_HOST=backup-server.example.com
PG_BACKUP_RSYNC_USER=backup
PG_BACKUP_RSYNC_PATH=/backups/postgres
PG_BACKUP_RSYNC_SSH_KEY_PATH=/var/lib/postgresql/.ssh/backup_key
```

### Optional: Email Alerts

Add to `/etc/pg-backup/pg-backup.env`:

```bash
PG_BACKUP_ALERT_SMTP_HOST=smtp.example.com
PG_BACKUP_ALERT_SMTP_PORT=587
PG_BACKUP_ALERT_SMTP_SECURE=false
PG_BACKUP_ALERT_SMTP_USER=alerts@example.com
PG_BACKUP_ALERT_SMTP_PASSWORD=your-smtp-password
PG_BACKUP_ALERT_FROM=backup@example.com
PG_BACKUP_ALERT_TO=admin@example.com
PG_BACKUP_ALERT_SUBJECT_PREFIX=[PROD-BACKUP]
```

### Optional: GPG Encryption

```bash
# Generate a strong passphrase
openssl rand -base64 32
```

Add to `/etc/pg-backup/pg-backup.env`:

```bash
PG_BACKUP_ENCRYPTION_ENABLED=true
PG_BACKUP_ENCRYPTION_PASSPHRASE=your-generated-passphrase
```

**Important:** Store the passphrase securely - you need it to restore!

### Restore Procedure

```bash
# List available backups
pg-backup list --backup-dir /var/lib/pg-backup/backups

# Restore database only
pg-backup restore <backup-id> --db-only --backup-dir /var/lib/pg-backup/backups

# Restore directories only
pg-backup restore <backup-id> --dirs-only --backup-dir /var/lib/pg-backup/backups

# Full restore (database + directories)
pg-backup restore <backup-id> --backup-dir /var/lib/pg-backup/backups
```

### Troubleshooting

**Timer not running:**
```bash
systemctl status pg-backup.timer
journalctl -u pg-backup.timer
```

**Backup fails:**
```bash
journalctl -u pg-backup.service --since "1 hour ago"
```

**Permission denied:**
```bash
# Ensure postgres user owns backup directory
sudo chown -R postgres:postgres /var/lib/pg-backup
```

**pg_dump not found:**
```bash
# Install PostgreSQL client tools
sudo apt install postgresql-client-16
```

**S3 upload fails:**
```bash
# Test AWS credentials
aws s3 ls s3://your-bucket --endpoint-url https://your-endpoint
```

### Monitoring

```bash
# Check last backup status
pg-backup status --backup-dir /var/lib/pg-backup/backups

# Verify specific backup
pg-backup verify <backup-id> --backup-dir /var/lib/pg-backup/backups

# Check disk usage
du -sh /var/lib/pg-backup/backups/*
```

---

## Development

TDD workflow: RED → GREEN → BLUE

1. Write failing tests first (`tests/*.test.ts`)
2. Implement minimal code to pass
3. Refactor while keeping tests green
4. Run full test suite: `bun test --randomize`
