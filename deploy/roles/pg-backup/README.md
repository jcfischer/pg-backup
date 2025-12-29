# Ansible Role: pg-backup

Deploy pg-backup PostgreSQL backup tool with automated systemd timer.

## Requirements

- Ansible 2.14+
- Debian/Ubuntu target system
- PostgreSQL database accessible from target

## Role Variables

### Required Variables

```yaml
pg_backup_db_name: "mydb"  # Database name to backup
```

### Optional Variables

See `defaults/main.yml` for all available variables. Key ones:

```yaml
# Database connection
pg_backup_db_host: "localhost"
pg_backup_db_port: 5432
pg_backup_db_user: "postgres"
pg_backup_db_password: ""  # Or use .pgpass

# Backup storage
pg_backup_dir: "/var/lib/pg-backup/backups"

# Directories to backup (comma-separated)
pg_backup_directories: "/var/www/uploads,/etc/myapp"

# Retention policy
pg_backup_retention_days: 30
pg_backup_retention_min_keep: 7

# Encryption
pg_backup_encryption_enabled: false
pg_backup_encryption_passphrase: ""

# Off-site sync: none, s3, rsync
pg_backup_offsite_type: "none"

# S3 configuration
pg_backup_s3_bucket: ""
pg_backup_s3_region: "eu-central-1"
pg_backup_s3_access_key_id: ""
pg_backup_s3_secret_access_key: ""

# Rsync configuration
pg_backup_rsync_host: ""
pg_backup_rsync_user: "backup"
pg_backup_rsync_path: "/backups/postgres"

# Email alerts
pg_backup_alert_enabled: false
pg_backup_alert_smtp_host: ""
pg_backup_alert_to: ""

# Timer schedule
pg_backup_timer_oncalendar: "*-*-* 03:00:00"
```

## Dependencies

None.

## Example Playbook

### Minimal Setup

```yaml
- hosts: database_servers
  become: true
  roles:
    - role: pg-backup
      pg_backup_db_name: "production"
```

### Full Configuration

```yaml
- hosts: database_servers
  become: true
  vars:
    # Database
    pg_backup_db_name: "production"
    pg_backup_db_host: "localhost"
    pg_backup_db_user: "postgres"

    # Directories
    pg_backup_directories: "/var/www/uploads,/etc/myapp"

    # Retention
    pg_backup_retention_days: 30
    pg_backup_retention_min_keep: 7

    # Encryption
    pg_backup_encryption_enabled: true
    pg_backup_encryption_passphrase: "{{ vault_backup_passphrase }}"

    # S3 off-site sync
    pg_backup_offsite_type: "s3"
    pg_backup_s3_bucket: "my-backups"
    pg_backup_s3_region: "eu-central-1"
    pg_backup_s3_access_key_id: "{{ vault_s3_key }}"
    pg_backup_s3_secret_access_key: "{{ vault_s3_secret }}"

    # Email alerts
    pg_backup_alert_enabled: true
    pg_backup_alert_smtp_host: "smtp.example.com"
    pg_backup_alert_smtp_port: 587
    pg_backup_alert_smtp_user: "alerts@example.com"
    pg_backup_alert_smtp_password: "{{ vault_smtp_password }}"
    pg_backup_alert_from: "backup@example.com"
    pg_backup_alert_to: "admin@example.com"

  roles:
    - pg-backup
```

## Usage

### Deploy

```bash
cd deploy
ansible-playbook -i inventory.yml playbook.yml
```

### With Ansible Vault for secrets

```bash
# Create vault file
ansible-vault create group_vars/all/vault.yml

# Add secrets:
# vault_backup_passphrase: "your-passphrase"
# vault_s3_access_key: "AKIA..."
# vault_s3_secret_key: "..."

# Run with vault
ansible-playbook -i inventory.yml playbook.yml --ask-vault-pass
```

### Manual Backup

```bash
# On target server
sudo systemctl start pg-backup.service

# Check logs
journalctl -u pg-backup.service -f
```

### Check Timer Status

```bash
systemctl list-timers pg-backup.timer
```

## What Gets Installed

1. **Bun runtime** - JavaScript/TypeScript runtime
2. **PostgreSQL client tools** - pg_dump, pg_restore
3. **pg-backup binary** - `/usr/local/bin/pg-backup`
4. **Configuration** - `/etc/pg-backup/pg-backup.env`
5. **Backup storage** - `/var/lib/pg-backup/backups`
6. **Systemd service** - `pg-backup.service`
7. **Systemd timer** - `pg-backup.timer` (daily at 03:00)

## License

MIT

## Author

Jens-Christian Fischer
