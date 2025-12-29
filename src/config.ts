/**
 * Configuration loading from environment variables
 */

import type {
  BackupConfig,
  DatabaseConfig,
  OffsiteConfig,
  AlertConfig,
  SmtpConfig,
  GFSConfig,
} from "./types";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const CONFIG_FILE_PATH = join(homedir(), ".config", "pg-backup", "config.json");

function getEnv(key: string, defaultValue?: string): string | undefined {
  return process.env[`PG_BACKUP_${key}`] ?? defaultValue;
}

function getEnvRequired(key: string): string {
  const value = getEnv(key);
  if (!value) {
    throw new Error(`Missing required environment variable: PG_BACKUP_${key}`);
  }
  return value;
}

function getEnvInt(key: string, defaultValue: number): number {
  const value = getEnv(key);
  return value ? parseInt(value, 10) : defaultValue;
}

function loadDatabaseConfig(): DatabaseConfig {
  return {
    host: getEnv("DB_HOST", "localhost")!,
    port: getEnvInt("DB_PORT", 5432),
    name: getEnvRequired("DB_NAME"),
    user: getEnv("DB_USER", "postgres")!,
    password: getEnv("DB_PASSWORD"),
  };
}

function loadOffsiteConfig(): OffsiteConfig | undefined {
  const type = getEnv("OFFSITE_TYPE");

  if (!type) {
    return undefined;
  }

  if (type === "s3") {
    const endpoint = getEnv("S3_ENDPOINT");
    const bucket = getEnv("S3_BUCKET");

    if (!endpoint || !bucket) {
      return undefined;
    }

    return {
      type: "s3",
      endpoint,
      bucket,
      prefix: getEnv("S3_PREFIX", "")!,
      accessKey: getEnvRequired("S3_ACCESS_KEY"),
      secretKey: getEnvRequired("S3_SECRET_KEY"),
      region: getEnv("S3_REGION", "auto")!,
    };
  }

  if (type === "rsync") {
    const host = getEnv("OFFSITE_HOST");
    if (!host) {
      return undefined;
    }

    return {
      type: "rsync",
      host,
      user: getEnv("OFFSITE_USER", "backup")!,
      path: getEnvRequired("OFFSITE_PATH"),
      sshKeyPath: getEnv("OFFSITE_SSH_KEY"),
    };
  }

  return undefined;
}

function loadGFSConfig(): GFSConfig | undefined {
  const enabled = getEnv("GFS_ENABLED");

  // GFS is only loaded when explicitly enabled
  if (!enabled || enabled.toLowerCase() !== "true") {
    return undefined;
  }

  return {
    enabled: true,
    daily: getEnvInt("GFS_DAILY", 7),
    weekly: getEnvInt("GFS_WEEKLY", 4),
    monthly: getEnvInt("GFS_MONTHLY", 12),
  };
}

function loadAlertConfig(): AlertConfig | undefined {
  const email = getEnv("ALERT_EMAIL");
  const smtpHost = getEnv("SMTP_HOST");

  if (!email || !smtpHost) {
    return undefined;
  }

  const smtp: SmtpConfig = {
    host: smtpHost,
    port: getEnvInt("SMTP_PORT", 587),
    user: getEnv("SMTP_USER", "")!,
    password: getEnv("SMTP_PASS", "")!,
    from: getEnv("SMTP_FROM", email)!,
  };

  return {
    enabled: true,
    email,
    smtp,
  };
}

function loadFromFile(): Partial<BackupConfig> | null {
  if (!existsSync(CONFIG_FILE_PATH)) {
    return null;
  }

  try {
    const content = readFileSync(CONFIG_FILE_PATH, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    console.warn(`Warning: Could not parse config file: ${CONFIG_FILE_PATH}`);
    return null;
  }
}

export function loadConfig(): BackupConfig {
  // Load from file first (lower priority)
  const fileConfig = loadFromFile();

  // Environment variables override file config
  const directories = getEnv("DIRS");
  const dirList = directories
    ? directories.split(",").map((d) => d.trim())
    : fileConfig?.directories ?? [];

  const gfsConfig = loadGFSConfig();

  const config: BackupConfig = {
    database: loadDatabaseConfig(),
    directories: dirList,
    backupDir: getEnv("DIR", "/var/backups/pg-backup")!,
    retention: {
      days: getEnvInt("RETENTION_DAYS", 30),
      minKeep: getEnvInt("MIN_KEEP", 7),
      ...(gfsConfig && { gfs: gfsConfig }),
    },
    encryptionKey: getEnv("ENCRYPTION_KEY"),
    offsite: loadOffsiteConfig(),
    alerts: loadAlertConfig(),
  };

  return config;
}

export function validateConfig(config: BackupConfig): string[] {
  const errors: string[] = [];

  if (!config.database.name) {
    errors.push("Database name is required (PG_BACKUP_DB_NAME)");
  }

  if (!config.backupDir) {
    errors.push("Backup directory is required (PG_BACKUP_DIR)");
  }

  if (config.offsite?.type === "s3") {
    if (!config.offsite.endpoint) {
      errors.push("S3 endpoint is required (PG_BACKUP_S3_ENDPOINT)");
    }
    if (!config.offsite.bucket) {
      errors.push("S3 bucket is required (PG_BACKUP_S3_BUCKET)");
    }
  }

  // Validate GFS config if present
  if (config.retention.gfs) {
    if (config.retention.gfs.daily < 0) {
      errors.push("GFS daily must be a non-negative integer");
    }
    if (config.retention.gfs.weekly < 0) {
      errors.push("GFS weekly must be a non-negative integer");
    }
    if (config.retention.gfs.monthly < 0) {
      errors.push("GFS monthly must be a non-negative integer");
    }
  }

  return errors;
}
