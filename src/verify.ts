/**
 * Verify service for checking backup integrity
 * Validates checksums of database dumps and directory archives
 */

import { existsSync } from "fs";
import { join, basename } from "path";
import type { BackupManifest } from "./types";
import { loadManifest, calculateChecksum } from "./manifest";

export interface VerifyItemResult {
  path: string;
  valid: boolean;
  expectedChecksum: string;
  actualChecksum?: string;
  error?: string;
}

export interface VerifyResult {
  success: boolean;
  backupId: string;
  manifest?: BackupManifest;
  database?: VerifyItemResult;
  directories?: VerifyItemResult[];
  duration: number;
  error?: string;
}

/**
 * VerifyService class for object-oriented usage
 */
export class VerifyService {
  public backupDir: string;

  constructor(backupDir: string) {
    this.backupDir = backupDir;
  }

  /**
   * Verify a backup by ID
   */
  async verify(backupId: string): Promise<VerifyResult> {
    return runVerify(this.backupDir, backupId);
  }
}

/**
 * Run verification on a backup
 */
export async function runVerify(
  backupDir: string,
  backupId: string
): Promise<VerifyResult> {
  const startTime = Date.now();
  const backupPath = join(backupDir, backupId);
  const manifestPath = join(backupPath, "manifest.json");

  // Check if backup exists
  if (!existsSync(manifestPath)) {
    const duration = Math.round((Date.now() - startTime) / 1000);
    return {
      success: false,
      backupId,
      duration,
      error: `Backup not found: ${backupId}`,
    };
  }

  // Load manifest
  let manifest: BackupManifest;
  try {
    manifest = await loadManifest(manifestPath);
  } catch (error) {
    const duration = Math.round((Date.now() - startTime) / 1000);
    return {
      success: false,
      backupId,
      duration,
      error: `Failed to load manifest: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  let allValid = true;

  // Verify database dump
  const dbFilename = manifest.encrypted
    ? `${manifest.database.name}.sql.gz.gpg`
    : `${manifest.database.name}.sql.gz`;
  const dbPath = join(backupPath, dbFilename);

  let databaseResult: VerifyItemResult;
  if (!existsSync(dbPath)) {
    databaseResult = {
      path: dbPath,
      valid: false,
      expectedChecksum: manifest.database.checksum,
      error: `Database dump not found: ${dbFilename}`,
    };
    allValid = false;
  } else {
    const actualChecksum = await calculateChecksum(dbPath);
    const valid = actualChecksum === manifest.database.checksum;
    databaseResult = {
      path: dbPath,
      valid,
      expectedChecksum: manifest.database.checksum,
      actualChecksum,
      error: valid ? undefined : `Checksum mismatch: expected ${manifest.database.checksum}, got ${actualChecksum}`,
    };
    if (!valid) allValid = false;
  }

  // Verify directory archives
  const directoryResults: VerifyItemResult[] = [];

  for (const dir of manifest.directories) {
    // Construct archive name from directory path
    const dirName = basename(dir.path).replace(/[^a-zA-Z0-9-_]/g, "_") || "dir";
    const archiveFilename = manifest.encrypted
      ? `${dirName}.tar.gz.gpg`
      : `${dirName}.tar.gz`;
    const archivePath = join(backupPath, archiveFilename);

    if (!existsSync(archivePath)) {
      directoryResults.push({
        path: dir.path,
        valid: false,
        expectedChecksum: dir.checksum,
        error: `Archive not found: ${archiveFilename}`,
      });
      allValid = false;
    } else {
      const actualChecksum = await calculateChecksum(archivePath);
      const valid = actualChecksum === dir.checksum;
      directoryResults.push({
        path: dir.path,
        valid,
        expectedChecksum: dir.checksum,
        actualChecksum,
        error: valid ? undefined : `Checksum mismatch: expected ${dir.checksum}, got ${actualChecksum}`,
      });
      if (!valid) allValid = false;
    }
  }

  const duration = Math.round((Date.now() - startTime) / 1000);

  return {
    success: allValid,
    backupId,
    manifest,
    database: databaseResult,
    directories: directoryResults.length > 0 ? directoryResults : undefined,
    duration,
  };
}
