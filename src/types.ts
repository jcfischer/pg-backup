/**
 * pg-backup type definitions
 */

export interface DatabaseConfig {
  host: string;
  port: number;
  name: string;
  user: string;
  password?: string;
}

export interface RetentionConfig {
  days: number;
  minKeep: number;
}

export interface RsyncOffsiteConfig {
  type: "rsync";
  host: string;
  user: string;
  path: string;
  sshKeyPath?: string;
  timeout?: number; // SSH connection timeout in seconds (default: 10)
}

export interface S3OffsiteConfig {
  type: "s3";
  endpoint: string;
  bucket: string;
  prefix: string;
  accessKey: string;
  secretKey: string;
  region: string;
}

export type OffsiteConfig = RsyncOffsiteConfig | S3OffsiteConfig;

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
}

export interface AlertConfig {
  enabled: boolean;
  email: string;
  smtp: SmtpConfig;
}

export interface BackupConfig {
  database: DatabaseConfig;
  directories: string[];
  backupDir: string;
  retention: RetentionConfig;
  encryptionKey?: string;
  offsite?: OffsiteConfig;
  alerts?: AlertConfig;
}

export interface BackupManifest {
  id: string;
  timestamp: string;
  version: string;
  database: {
    name: string;
    size: number;
    checksum: string;
    tableCount?: number;
  };
  directories: Array<{
    path: string;
    size: number;
    fileCount: number;
    checksum: string;
  }>;
  encrypted: boolean;
  status: "complete" | "failed" | "partial";
  duration: number;
  offsite?: {
    synced: boolean;
    syncedAt?: string;
    type?: "rsync" | "s3";
  };
}

export interface BackupResult {
  success: boolean;
  manifest?: BackupManifest;
  error?: string;
  backupPath?: string;
}

export interface RestoreOptions {
  targetDatabase?: string;
  skipDirectories?: boolean;
  skipDatabase?: boolean;
}

export interface PruneResult {
  deleted: string[];
  kept: string[];
  errors: string[];
}

export interface VerifyResult {
  valid: boolean;
  checksumValid: boolean;
  databaseRestoreTest?: boolean;
  errors: string[];
}
