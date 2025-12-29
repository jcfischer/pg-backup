/**
 * Backup service orchestrator
 * Coordinates: database dump → directory archive → encryption → offsite sync → manifest
 */

import { existsSync } from "fs";
import { mkdir, readdir } from "fs/promises";
import { join, basename } from "path";
import type {
  BackupConfig,
  BackupResult,
  BackupManifest,
  S3OffsiteConfig,
  RsyncOffsiteConfig,
} from "./types";
import { dumpDatabase, checkPgDumpAvailable, type DumpResult } from "./database";
import { archiveDirectory, type ArchiveResult } from "./directories";
import { encryptFile, checkGpgAvailable } from "./encryption";
import { syncToS3 } from "./offsite-s3";
import { syncFilesToRemote } from "./offsite-rsync";
import { createManifest, saveManifest, calculateChecksum } from "./manifest";

/**
 * BackupService class for object-oriented usage
 */
export class BackupService {
  public config: BackupConfig;

  constructor(config: BackupConfig) {
    this.config = config;
  }

  /**
   * Run the backup process
   */
  async run(): Promise<BackupResult> {
    return runBackup(this.config);
  }
}

/**
 * Run a complete backup with the given configuration
 * Functional interface for the backup process
 */
export async function runBackup(config: BackupConfig): Promise<BackupResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  const filesToSync: string[] = [];

  // Ensure backup directory exists
  await mkdir(config.backupDir, { recursive: true });

  // Generate backup ID based on timestamp
  const backupId = generateBackupId();
  const backupPath = join(config.backupDir, backupId);
  await mkdir(backupPath, { recursive: true });

  // Track results
  let databaseResult: DumpResult | null = null;
  let databaseChecksum = "";
  const directoryResults: Array<{
    path: string;
    size: number;
    fileCount: number;
    checksum: string;
  }> = [];

  // Step 1: Database dump
  const dbDumpPath = join(backupPath, `${config.database.name}.sql.gz`);
  const pgDumpAvailable = await checkPgDumpAvailable();

  if (!pgDumpAvailable) {
    errors.push("pg_dump not available - cannot backup database");
    databaseResult = {
      success: false,
      path: dbDumpPath,
      size: 0,
      error: "pg_dump not available",
    };
  } else {
    try {
      databaseResult = await dumpDatabase(config.database, dbDumpPath);
      if (!databaseResult.success) {
        errors.push(`Database dump failed: ${databaseResult.error}`);
      } else {
        filesToSync.push(dbDumpPath);
        // Calculate checksum
        databaseChecksum = await calculateChecksum(dbDumpPath);
      }
    } catch (error) {
      errors.push(`Database dump error: ${error instanceof Error ? error.message : String(error)}`);
      databaseResult = {
        success: false,
        path: dbDumpPath,
        size: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Step 2: Directory archiving
  for (const dirPath of config.directories) {
    if (!existsSync(dirPath)) {
      continue; // Skip non-existent directories
    }

    const dirName = basename(dirPath).replace(/[^a-zA-Z0-9-_]/g, "_");
    const archivePath = join(backupPath, `${dirName}.tar.gz`);

    try {
      const result = await archiveDirectory(dirPath, archivePath);
      if (result.success) {
        const checksum = await calculateChecksum(archivePath);
        directoryResults.push({
          path: dirPath,
          size: result.size,
          fileCount: result.fileCount,
          checksum,
        });
        filesToSync.push(archivePath);
      } else {
        errors.push(`Directory archive failed for ${dirPath}: ${result.error}`);
      }
    } catch (error) {
      errors.push(`Directory archive error for ${dirPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Step 3: Encryption (if configured)
  const encrypted = !!config.encryptionKey;
  if (config.encryptionKey) {
    const gpgAvailable = await checkGpgAvailable();
    if (gpgAvailable) {
      const encryptedFiles: string[] = [];
      for (const file of filesToSync) {
        const encryptedPath = `${file}.gpg`;
        try {
          const result = await encryptFile(file, encryptedPath, config.encryptionKey);
          if (result.success) {
            encryptedFiles.push(encryptedPath);
            // Update checksum for encrypted file
            if (file === dbDumpPath) {
              databaseChecksum = await calculateChecksum(encryptedPath);
            }
            for (const dir of directoryResults) {
              const expectedArchive = join(backupPath, `${basename(dir.path).replace(/[^a-zA-Z0-9-_]/g, "_")}.tar.gz`);
              if (file === expectedArchive) {
                dir.checksum = await calculateChecksum(encryptedPath);
              }
            }
          } else {
            errors.push(`Encryption failed for ${file}: ${result.error}`);
            encryptedFiles.push(file); // Keep unencrypted file in sync list
          }
        } catch (error) {
          errors.push(`Encryption error for ${file}: ${error instanceof Error ? error.message : String(error)}`);
          encryptedFiles.push(file);
        }
      }
      // Update filesToSync with encrypted paths
      filesToSync.length = 0;
      filesToSync.push(...encryptedFiles);
    } else {
      errors.push("GPG not available - skipping encryption");
    }
  }

  // Step 4: Offsite sync (if configured)
  let offsiteResult: { synced: boolean; syncedAt?: string; type?: "rsync" | "s3" } | undefined;
  if (config.offsite) {
    if (config.offsite.type === "s3") {
      try {
        const s3Config = config.offsite as S3OffsiteConfig;
        const result = await syncToS3(s3Config, filesToSync);
        offsiteResult = {
          synced: result.success,
          syncedAt: result.success ? new Date().toISOString() : undefined,
          type: "s3",
        };
        if (!result.success) {
          errors.push(`S3 sync errors: ${result.errors.join(", ")}`);
        }
      } catch (error) {
        offsiteResult = { synced: false, type: "s3" };
        errors.push(`S3 sync error: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else if (config.offsite.type === "rsync") {
      try {
        const rsyncConfig = config.offsite as RsyncOffsiteConfig;
        const result = await syncFilesToRemote(rsyncConfig, filesToSync);
        offsiteResult = {
          synced: result.success,
          syncedAt: result.success ? new Date().toISOString() : undefined,
          type: "rsync",
        };
        if (!result.success && result.error) {
          errors.push(`Rsync sync error: ${result.error}`);
        }
      } catch (error) {
        offsiteResult = { synced: false, type: "rsync" };
        errors.push(`Rsync sync error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  // Calculate duration
  const duration = Math.round((Date.now() - startTime) / 1000);

  // Determine success status
  // Success if database dump succeeded (or no database errors for directory-only backup)
  const databaseSuccess = databaseResult?.success ?? false;
  const hasDirectories = config.directories.length > 0;
  const directorySuccess = !hasDirectories || directoryResults.length > 0;

  // Backup is successful if database succeeded
  // (directories are optional - we continue even if some fail)
  const success = databaseSuccess;

  // Determine status
  let status: "complete" | "failed" | "partial";
  if (success && errors.length === 0) {
    status = "complete";
  } else if (!success) {
    status = "failed";
  } else {
    status = "partial"; // Some non-critical errors
  }

  // Step 5: Create and save manifest
  const manifest = createManifest({
    databaseName: config.database.name,
    databaseSize: databaseResult?.size ?? 0,
    databaseChecksum,
    tableCount: databaseResult?.tableCount,
    directories: directoryResults,
    encrypted,
    duration,
    status,
    offsite: offsiteResult,
  });

  // Override generated ID with our consistent one
  (manifest as BackupManifest).id = backupId;

  try {
    await saveManifest(config.backupDir, manifest);
  } catch (error) {
    errors.push(`Failed to save manifest: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    success,
    manifest,
    backupPath,
    error: errors.length > 0 ? errors.join("; ") : undefined,
  };
}

/**
 * Generate a backup ID based on current timestamp
 */
function generateBackupId(): string {
  const now = new Date();
  const iso = now.toISOString();
  // Convert 2025-12-28T12:00:00.000Z to backup-2025-12-28T12-00-00
  const formatted = iso.slice(0, 19).replace(/:/g, "-");
  return `backup-${formatted}`;
}
