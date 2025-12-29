/**
 * Prune service for managing backup retention
 * Deletes old backups based on retention policy
 */

import { existsSync } from "fs";
import { rm } from "fs/promises";
import { join } from "path";
import type { RetentionConfig, BackupManifest } from "./types";
import { listManifests } from "./manifest";

export interface PruneOptions {
  dryRun?: boolean;
}

export interface PruneResult {
  success: boolean;
  pruned: string[];
  kept: string[];
  dryRun?: boolean;
  error?: string;
}

/**
 * PruneService class for object-oriented usage
 */
export class PruneService {
  public backupDir: string;
  public retention: RetentionConfig;

  constructor(backupDir: string, retention: RetentionConfig) {
    this.backupDir = backupDir;
    this.retention = retention;
  }

  /**
   * Prune old backups according to retention policy
   */
  async prune(): Promise<PruneResult> {
    return runPrune(this.backupDir, this.retention);
  }

  /**
   * Dry run - show what would be pruned without deleting
   */
  async dryRun(): Promise<PruneResult> {
    return runPrune(this.backupDir, this.retention, { dryRun: true });
  }
}

/**
 * Calculate backup age in days
 */
export function getBackupAge(timestamp: string, now: Date = new Date()): number {
  const backupDate = new Date(timestamp);
  const diffMs = now.getTime() - backupDate.getTime();
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  return diffDays;
}

/**
 * Determine if a backup should be pruned
 * @param retention - Retention configuration
 * @param backupAge - Age of backup in days
 * @param totalBackups - Total number of backups
 * @param backupIndex - Index of this backup (0 = newest)
 */
export function shouldPrune(
  retention: RetentionConfig,
  backupAge: number,
  totalBackups: number,
  backupIndex: number
): boolean {
  // Never prune if we don't have enough backups to meet minKeep
  if (totalBackups <= retention.minKeep) {
    return false;
  }

  // Never prune the newest minKeep backups
  if (backupIndex < retention.minKeep) {
    return false;
  }

  // Prune if older than retention days
  return backupAge > retention.days;
}

/**
 * Run prune operation
 */
export async function runPrune(
  backupDir: string,
  retention: RetentionConfig,
  options?: PruneOptions
): Promise<PruneResult> {
  const pruned: string[] = [];
  const kept: string[] = [];
  const errors: string[] = [];
  const dryRun = options?.dryRun || false;

  // Handle non-existent backup directory gracefully
  if (!existsSync(backupDir)) {
    return {
      success: true,
      pruned: [],
      kept: [],
      dryRun,
    };
  }

  try {
    // Get all backups sorted by date (newest first - listManifests returns this order)
    const manifests = await listManifests(backupDir);

    if (manifests.length === 0) {
      return {
        success: true,
        pruned: [],
        kept: [],
        dryRun,
      };
    }

    const now = new Date();

    // Process each backup
    for (let i = 0; i < manifests.length; i++) {
      const manifest = manifests[i];
      const age = getBackupAge(manifest.timestamp, now);

      if (shouldPrune(retention, age, manifests.length, i)) {
        pruned.push(manifest.id);

        if (!dryRun) {
          try {
            const backupPath = join(backupDir, manifest.id);
            await rm(backupPath, { recursive: true, force: true });
          } catch (error) {
            errors.push(
              `Failed to delete ${manifest.id}: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
      } else {
        kept.push(manifest.id);
      }
    }

    return {
      success: errors.length === 0,
      pruned,
      kept,
      dryRun,
      error: errors.length > 0 ? errors.join("; ") : undefined,
    };
  } catch (error) {
    return {
      success: false,
      pruned,
      kept,
      dryRun,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
