/**
 * Backup manifest operations
 * Create, save, load, and list backup manifests
 */

import { existsSync } from "fs";
import { readFile, writeFile, mkdir, readdir } from "fs/promises";
import { join, dirname } from "path";
import { createHash } from "crypto";
import type { BackupManifest } from "./types";

// Read version from package.json
const VERSION = "0.1.0";

export interface CreateManifestOptions {
  databaseName: string;
  databaseSize: number;
  databaseChecksum: string;
  tableCount?: number;
  directories: Array<{
    path: string;
    size: number;
    fileCount: number;
    checksum: string;
  }>;
  encrypted: boolean;
  duration: number;
  status?: "complete" | "failed" | "partial";
  offsite?: {
    synced: boolean;
    syncedAt?: string;
    type?: "rsync" | "s3";
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

/**
 * Create a new backup manifest
 */
export function createManifest(options: CreateManifestOptions): BackupManifest {
  const now = new Date();

  return {
    id: generateBackupId(),
    timestamp: now.toISOString(),
    version: VERSION,
    database: {
      name: options.databaseName,
      size: options.databaseSize,
      checksum: options.databaseChecksum,
      tableCount: options.tableCount,
    },
    directories: options.directories,
    encrypted: options.encrypted,
    status: options.status ?? "complete",
    duration: options.duration,
    offsite: options.offsite,
  };
}

/**
 * Save manifest to backup directory
 * Creates subdirectory named after backup ID
 */
export async function saveManifest(
  backupDir: string,
  manifest: BackupManifest
): Promise<string> {
  const backupSubdir = join(backupDir, manifest.id);
  await mkdir(backupSubdir, { recursive: true });

  const manifestPath = join(backupSubdir, "manifest.json");
  const content = JSON.stringify(manifest, null, 2);
  await writeFile(manifestPath, content, "utf-8");

  return manifestPath;
}

/**
 * Load manifest from file
 */
export async function loadManifest(manifestPath: string): Promise<BackupManifest> {
  if (!existsSync(manifestPath)) {
    throw new Error(`Manifest not found: ${manifestPath}`);
  }

  const content = await readFile(manifestPath, "utf-8");
  return JSON.parse(content) as BackupManifest;
}

/**
 * List all manifests in backup directory
 * Returns manifests sorted by timestamp descending (newest first)
 */
export async function listManifests(backupDir: string): Promise<BackupManifest[]> {
  if (!existsSync(backupDir)) {
    return [];
  }

  const entries = await readdir(backupDir, { withFileTypes: true });
  const manifests: BackupManifest[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const manifestPath = join(backupDir, entry.name, "manifest.json");
    if (!existsSync(manifestPath)) continue;

    try {
      const manifest = await loadManifest(manifestPath);
      manifests.push(manifest);
    } catch {
      // Skip invalid manifests
      continue;
    }
  }

  // Sort by timestamp descending
  manifests.sort((a, b) => {
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });

  return manifests;
}

/**
 * Get the most recent manifest
 */
export async function getLatestManifest(
  backupDir: string
): Promise<BackupManifest | null> {
  const manifests = await listManifests(backupDir);
  return manifests.length > 0 ? manifests[0] : null;
}

/**
 * Calculate SHA-256 checksum of a file
 */
export async function calculateChecksum(filePath: string): Promise<string> {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const content = await readFile(filePath);
  const hash = createHash("sha256");
  hash.update(content);
  return hash.digest("hex");
}

/**
 * Get backup directory path for a manifest
 */
export function getBackupPath(backupDir: string, backupId: string): string {
  return join(backupDir, backupId);
}

/**
 * Check if a backup exists
 */
export function backupExists(backupDir: string, backupId: string): boolean {
  const manifestPath = join(backupDir, backupId, "manifest.json");
  return existsSync(manifestPath);
}
