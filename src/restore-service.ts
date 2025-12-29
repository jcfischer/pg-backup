/**
 * Restore service orchestrator
 * Coordinates: load manifest → download (if needed) → decrypt → extract → restore
 */

import { existsSync } from "fs";
import { mkdir, readdir } from "fs/promises";
import { join, basename } from "path";
import type {
  BackupManifest,
  RestoreOptions,
  S3OffsiteConfig,
  RsyncOffsiteConfig,
  OffsiteConfig,
  DatabaseConfig,
} from "./types";
import { restoreDatabase, checkPgDumpAvailable } from "./database";
import { extractArchive } from "./directories";
import { decryptFile, checkGpgAvailable } from "./encryption";
import { downloadFromS3 } from "./offsite-s3";
import { downloadFromRemote } from "./offsite-rsync";
import { loadManifest, listManifests, backupExists } from "./manifest";

export interface ExtendedRestoreOptions extends RestoreOptions {
  targetDir?: string;
  decryptionKey?: string;
  offsiteConfig?: OffsiteConfig;
  databaseConfig?: DatabaseConfig;
}

export interface RestoreResult {
  success: boolean;
  manifest?: BackupManifest;
  databaseRestored: boolean;
  directoriesRestored: string[];
  duration: number;
  error?: string;
}

/**
 * RestoreService class for object-oriented usage
 */
export class RestoreService {
  public backupDir: string;

  constructor(backupDir: string) {
    this.backupDir = backupDir;
  }

  /**
   * Restore a backup by ID
   */
  async restore(backupId: string, options?: ExtendedRestoreOptions): Promise<RestoreResult> {
    return runRestore(this.backupDir, backupId, options);
  }

  /**
   * List all available backups
   */
  async listBackups(): Promise<BackupManifest[]> {
    return listManifests(this.backupDir);
  }
}

/**
 * Run a restore operation
 * Functional interface for the restore process
 */
export async function runRestore(
  backupDir: string,
  backupId: string,
  options?: ExtendedRestoreOptions
): Promise<RestoreResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  const directoriesRestored: string[] = [];
  let databaseRestored = false;
  let manifest: BackupManifest | undefined;

  // Check if backup exists locally first
  const backupPath = join(backupDir, backupId);
  const manifestPath = join(backupPath, "manifest.json");

  // Try to download from offsite if not found locally
  if (!existsSync(manifestPath) && options?.offsiteConfig) {
    try {
      await downloadBackupFromOffsite(backupDir, backupId, options.offsiteConfig);
    } catch (error) {
      const duration = Math.round((Date.now() - startTime) / 1000);
      return {
        success: false,
        databaseRestored: false,
        directoriesRestored: [],
        duration,
        error: `Backup not found locally and failed to download: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // Load manifest
  if (!existsSync(manifestPath)) {
    const duration = Math.round((Date.now() - startTime) / 1000);
    return {
      success: false,
      databaseRestored: false,
      directoriesRestored: [],
      duration,
      error: `Backup not found: ${backupId}`,
    };
  }

  try {
    manifest = await loadManifest(manifestPath);
  } catch (error) {
    const duration = Math.round((Date.now() - startTime) / 1000);
    return {
      success: false,
      databaseRestored: false,
      directoriesRestored: [],
      duration,
      error: `Failed to load manifest: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  // Check if decryption is needed
  if (manifest.encrypted && !options?.decryptionKey) {
    const duration = Math.round((Date.now() - startTime) / 1000);
    return {
      success: false,
      manifest,
      databaseRestored: false,
      directoriesRestored: [],
      duration,
      error: "Backup is encrypted but no decryption key provided. Cannot decrypt without key.",
    };
  }

  // Decrypt files if needed
  if (manifest.encrypted && options?.decryptionKey) {
    const gpgAvailable = await checkGpgAvailable();
    if (!gpgAvailable) {
      errors.push("GPG not available - cannot decrypt");
    } else {
      // Decrypt database dump
      const encryptedDbPath = join(backupPath, `${manifest.database.name}.sql.gz.gpg`);
      if (existsSync(encryptedDbPath)) {
        const decryptedPath = join(backupPath, `${manifest.database.name}.sql.gz`);
        const result = await decryptFile(encryptedDbPath, decryptedPath, options.decryptionKey);
        if (!result.success) {
          errors.push(`Failed to decrypt database: ${result.error}`);
        }
      }

      // Decrypt directory archives
      const files = await readdir(backupPath);
      for (const file of files) {
        if (file.endsWith(".tar.gz.gpg")) {
          const encryptedPath = join(backupPath, file);
          const decryptedPath = join(backupPath, file.replace(".gpg", ""));
          const result = await decryptFile(encryptedPath, decryptedPath, options.decryptionKey);
          if (!result.success) {
            errors.push(`Failed to decrypt ${file}: ${result.error}`);
          }
        }
      }
    }
  }

  // Restore directories (unless skipped)
  if (!options?.skipDirectories) {
    const targetDir = options?.targetDir || join(backupPath, "restored");
    await mkdir(targetDir, { recursive: true });

    // Find all .tar.gz files in backup
    const files = await readdir(backupPath);
    for (const file of files) {
      if (file.endsWith(".tar.gz") && !file.endsWith(".gpg")) {
        const archivePath = join(backupPath, file);
        const result = await extractArchive(archivePath, targetDir);
        if (result.success) {
          directoriesRestored.push(file.replace(".tar.gz", ""));
        } else {
          errors.push(`Failed to extract ${file}: ${result.error}`);
        }
      }
    }
  }

  // Restore database (unless skipped)
  if (!options?.skipDatabase) {
    const dumpPath = join(backupPath, `${manifest.database.name}.sql.gz`);

    if (existsSync(dumpPath)) {
      // Check if pg_restore/psql is available
      const pgAvailable = await checkPgDumpAvailable();
      if (!pgAvailable) {
        errors.push("PostgreSQL tools not available - cannot restore database");
      } else if (options?.databaseConfig) {
        const result = await restoreDatabase(
          options.databaseConfig,
          dumpPath,
          options.targetDatabase
        );
        if (result.success) {
          databaseRestored = true;
        } else {
          errors.push(`Database restore failed: ${result.error}`);
        }
      } else {
        errors.push("No database configuration provided for restore");
      }
    } else {
      errors.push(`Database dump not found: ${dumpPath}`);
    }
  }

  const duration = Math.round((Date.now() - startTime) / 1000);

  // Determine overall success
  const success = errors.length === 0 || (
    (options?.skipDatabase || databaseRestored) &&
    (options?.skipDirectories || directoriesRestored.length > 0)
  );

  return {
    success,
    manifest,
    databaseRestored,
    directoriesRestored,
    duration,
    error: errors.length > 0 ? errors.join("; ") : undefined,
  };
}

/**
 * Download a backup from offsite storage
 */
async function downloadBackupFromOffsite(
  backupDir: string,
  backupId: string,
  config: OffsiteConfig
): Promise<void> {
  const backupPath = join(backupDir, backupId);
  await mkdir(backupPath, { recursive: true });

  if (config.type === "s3") {
    const s3Config = config as S3OffsiteConfig;

    // Download manifest first
    const manifestResult = await downloadFromS3(
      s3Config,
      `${backupId}/manifest.json`,
      join(backupPath, "manifest.json")
    );

    if (!manifestResult.success) {
      throw new Error(`Failed to download manifest: ${manifestResult.error}`);
    }

    // Load manifest to get file list
    const manifest = await loadManifest(join(backupPath, "manifest.json"));

    // Download database dump
    const dbFilename = `${manifest.database.name}.sql.gz${manifest.encrypted ? ".gpg" : ""}`;
    await downloadFromS3(s3Config, `${backupId}/${dbFilename}`, join(backupPath, dbFilename));

    // Download directory archives
    for (const dir of manifest.directories) {
      const archiveName = `${basename(dir.path).replace(/[^a-zA-Z0-9-_]/g, "_")}.tar.gz${manifest.encrypted ? ".gpg" : ""}`;
      await downloadFromS3(s3Config, `${backupId}/${archiveName}`, join(backupPath, archiveName));
    }
  } else if (config.type === "rsync") {
    const rsyncConfig = config as RsyncOffsiteConfig;

    // Download manifest first
    const manifestResult = await downloadFromRemote(
      rsyncConfig,
      `${backupId}/manifest.json`,
      join(backupPath, "manifest.json")
    );

    if (!manifestResult.success) {
      throw new Error(`Failed to download manifest: ${manifestResult.error}`);
    }

    // Load manifest to get file list
    const manifest = await loadManifest(join(backupPath, "manifest.json"));

    // Download database dump
    const dbFilename = `${manifest.database.name}.sql.gz${manifest.encrypted ? ".gpg" : ""}`;
    await downloadFromRemote(rsyncConfig, `${backupId}/${dbFilename}`, join(backupPath, dbFilename));

    // Download directory archives
    for (const dir of manifest.directories) {
      const archiveName = `${basename(dir.path).replace(/[^a-zA-Z0-9-_]/g, "_")}.tar.gz${manifest.encrypted ? ".gpg" : ""}`;
      await downloadFromRemote(rsyncConfig, `${backupId}/${archiveName}`, join(backupPath, archiveName));
    }
  }
}
