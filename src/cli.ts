#!/usr/bin/env bun
/**
 * pg-backup CLI
 * PostgreSQL backup and restore tool
 */

import { Command } from "commander";
import { loadConfig, type PartialBackupConfig } from "./config";
import { runBackup, BackupService } from "./backup-service";
import { runRestore, RestoreService } from "./restore-service";
import { listManifests, getLatestManifest, loadManifest, backupExists } from "./manifest";
import { verifyArchive } from "./directories";
import { calculateChecksum } from "./manifest";
import { getBackupsToPrune, classifyBackups } from "./gfs";
import { existsSync } from "fs";
import { join } from "path";

const VERSION = "0.1.0";

const program = new Command();

program
  .name("pg-backup")
  .description("PostgreSQL backup and restore tool")
  .version(VERSION);

// Backup command
program
  .command("backup")
  .description("Run a database backup")
  .option("-c, --config <path>", "Path to config file")
  .option("--backup-dir <path>", "Backup directory")
  .option("--encryption-key <key>", "Encryption key for backup")
  .option("--no-offsite", "Skip offsite sync")
  .option("-v, --verbose", "Verbose output")
  .action(async (options) => {
    try {
      const config = await loadConfig();

      // Override with CLI options
      if (options.backupDir) {
        config.backupDir = options.backupDir;
      }
      if (options.encryptionKey) {
        config.encryptionKey = options.encryptionKey;
      }
      if (options.noOffsite) {
        config.offsite = undefined;
      }

      if (options.verbose) {
        console.log("Starting backup...");
        console.log(`Database: ${config.database.name}@${config.database.host}`);
        console.log(`Backup directory: ${config.backupDir}`);
        console.log(`Directories: ${config.directories.join(", ") || "(none)"}`);
        console.log(`Encryption: ${config.encryptionKey ? "enabled" : "disabled"}`);
      }

      const result = await runBackup(config);

      if (result.success) {
        console.log(`✅ Backup complete: ${result.manifest?.id}`);
        console.log(`   Duration: ${result.manifest?.duration}s`);
        console.log(`   Database size: ${formatBytes(result.manifest?.database.size || 0)}`);
        if (result.manifest?.directories.length) {
          console.log(`   Directories: ${result.manifest.directories.length}`);
        }
        if (result.manifest?.offsite?.synced) {
          console.log(`   Offsite: synced to ${result.manifest.offsite.type}`);
        }
      } else {
        console.error(`❌ Backup failed: ${result.error}`);
        process.exit(1);
      }
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

// Restore command
program
  .command("restore")
  .description("Restore a backup")
  .argument("<backup-id>", "Backup ID to restore")
  .option("--backup-dir <path>", "Backup directory")
  .option("--target-dir <path>", "Target directory for restored files")
  .option("--target-database <name>", "Target database name")
  .option("--decryption-key <key>", "Decryption key for encrypted backup")
  .option("--skip-database", "Skip database restore")
  .option("--skip-directories", "Skip directory restore")
  .option("-v, --verbose", "Verbose output")
  .action(async (backupId, options) => {
    try {
      const config = await loadConfig();
      const backupDir = options.backupDir || config.backupDir;

      if (options.verbose) {
        console.log(`Restoring backup: ${backupId}`);
        console.log(`From: ${backupDir}`);
      }

      const result = await runRestore(backupDir, backupId, {
        targetDir: options.targetDir,
        targetDatabase: options.targetDatabase,
        decryptionKey: options.decryptionKey,
        skipDatabase: options.skipDatabase,
        skipDirectories: options.skipDirectories,
        databaseConfig: config.database,
      });

      if (result.success) {
        console.log(`✅ Restore complete`);
        console.log(`   Duration: ${result.duration}s`);
        if (result.databaseRestored) {
          console.log(`   Database: restored`);
        }
        if (result.directoriesRestored.length > 0) {
          console.log(`   Directories: ${result.directoriesRestored.join(", ")}`);
        }
      } else {
        console.error(`❌ Restore failed: ${result.error}`);
        process.exit(1);
      }
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

// List command
program
  .command("list")
  .description("List all backups")
  .option("--backup-dir <path>", "Backup directory")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    try {
      // Only load config if needed (for backup-dir or GFS settings)
      let backupDir = options.backupDir;
      let gfsConfig: { enabled: boolean; daily: number; weekly: number; monthly: number } | undefined;

      if (!backupDir) {
        const config = await loadConfig();
        backupDir = config.backupDir;
        gfsConfig = config.retention.gfs;
      } else {
        // Try to load config for GFS settings, but don't fail if DB_NAME isn't set
        try {
          const config = await loadConfig();
          gfsConfig = config.retention.gfs;
        } catch {
          // Config loading failed (e.g., no DB_NAME) - continue without GFS
        }
      }

      const manifests = await listManifests(backupDir);

      if (manifests.length === 0) {
        console.log("No backups found.");
        return;
      }

      // Build tier map if GFS is enabled
      const tierMap = new Map<string, { tier: string; reason: string }>();
      if (gfsConfig?.enabled) {
        const classified = classifyBackups(manifests, gfsConfig);
        for (const c of classified) {
          tierMap.set(c.manifest.id, { tier: c.tier, reason: c.tierReason });
        }
      }

      if (options.json) {
        // Include tier info in JSON output when GFS is enabled
        if (gfsConfig?.enabled) {
          const withTiers = manifests.map((m) => ({
            ...m,
            gfsTier: tierMap.get(m.id),
          }));
          console.log(JSON.stringify(withTiers, null, 2));
        } else {
          console.log(JSON.stringify(manifests, null, 2));
        }
        return;
      }

      console.log(`Found ${manifests.length} backup(s):\n`);
      for (const manifest of manifests) {
        const date = new Date(manifest.timestamp).toLocaleString();
        const status = manifest.status === "complete" ? "✅" : manifest.status === "failed" ? "❌" : "⚠️";
        console.log(`${status} ${manifest.id}`);
        console.log(`   Date: ${date}`);
        console.log(`   Database: ${manifest.database.name} (${formatBytes(manifest.database.size)})`);
        console.log(`   Encrypted: ${manifest.encrypted ? "yes" : "no"}`);
        console.log(`   Directories: ${manifest.directories.length}`);

        // Show GFS tier info when enabled
        const tierInfo = tierMap.get(manifest.id);
        if (tierInfo) {
          const tierIcon = tierInfo.tier === "daily" ? "📅" : tierInfo.tier === "weekly" ? "📆" : tierInfo.tier === "monthly" ? "🗓️" : "🗑️";
          console.log(`   Tier: ${tierIcon} ${tierInfo.tier} (${tierInfo.reason})`);
        }
        console.log("");
      }
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

// Status command
program
  .command("status")
  .description("Show backup status")
  .option("--backup-dir <path>", "Backup directory")
  .action(async (options) => {
    try {
      let backupDir = options.backupDir;
      if (!backupDir) {
        const config = await loadConfig();
        backupDir = config.backupDir;
      }

      const latest = await getLatestManifest(backupDir);

      if (!latest) {
        console.log("No backups found.");
        return;
      }

      const date = new Date(latest.timestamp).toLocaleString();
      const age = Math.round((Date.now() - new Date(latest.timestamp).getTime()) / (1000 * 60 * 60));

      console.log("Latest Backup Status:");
      console.log(`  ID: ${latest.id}`);
      console.log(`  Status: ${latest.status}`);
      console.log(`  Date: ${date} (${age} hours ago)`);
      console.log(`  Database: ${latest.database.name} (${formatBytes(latest.database.size)})`);
      console.log(`  Encrypted: ${latest.encrypted ? "yes" : "no"}`);
      console.log(`  Directories: ${latest.directories.length}`);
      if (latest.offsite) {
        console.log(`  Offsite: ${latest.offsite.synced ? "synced" : "not synced"} (${latest.offsite.type})`);
      }
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

// Verify command
program
  .command("verify")
  .description("Verify backup integrity")
  .argument("<backup-id>", "Backup ID to verify")
  .option("--backup-dir <path>", "Backup directory")
  .option("-v, --verbose", "Verbose output")
  .action(async (backupId, options) => {
    try {
      const config = await loadConfig();
      const backupDir = options.backupDir || config.backupDir;

      if (!backupExists(backupDir, backupId)) {
        console.error(`❌ Backup not found: ${backupId}`);
        process.exit(1);
      }

      const manifestPath = join(backupDir, backupId, "manifest.json");
      const manifest = await loadManifest(manifestPath);

      console.log(`Verifying backup: ${backupId}`);

      let allValid = true;

      // Verify database dump
      const dbPath = join(backupDir, backupId, `${manifest.database.name}.sql.gz${manifest.encrypted ? ".gpg" : ""}`);
      if (existsSync(dbPath)) {
        if (options.verbose) {
          console.log(`  Checking database dump...`);
        }
        const checksum = await calculateChecksum(dbPath);
        if (checksum === manifest.database.checksum) {
          console.log(`  ✅ Database checksum valid`);
        } else {
          console.log(`  ❌ Database checksum mismatch`);
          allValid = false;
        }
      } else {
        console.log(`  ⚠️ Database dump not found`);
        allValid = false;
      }

      // Verify directory archives
      for (const dir of manifest.directories) {
        const archiveName = `${dir.path.split("/").pop()?.replace(/[^a-zA-Z0-9-_]/g, "_") || "dir"}.tar.gz${manifest.encrypted ? ".gpg" : ""}`;
        const archivePath = join(backupDir, backupId, archiveName);

        if (existsSync(archivePath)) {
          if (options.verbose) {
            console.log(`  Checking ${archiveName}...`);
          }
          const checksum = await calculateChecksum(archivePath);
          if (checksum === dir.checksum) {
            console.log(`  ✅ ${dir.path} checksum valid`);
          } else {
            console.log(`  ❌ ${dir.path} checksum mismatch`);
            allValid = false;
          }
        } else {
          console.log(`  ⚠️ Archive not found: ${archiveName}`);
          allValid = false;
        }
      }

      if (allValid) {
        console.log(`\n✅ Backup verification passed`);
      } else {
        console.log(`\n❌ Backup verification failed`);
        process.exit(1);
      }
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

// Prune command
program
  .command("prune")
  .description("Delete old backups based on retention policy")
  .option("--backup-dir <path>", "Backup directory")
  .option("--keep <count>", "Minimum number of backups to keep", parseInt)
  .option("--days <days>", "Delete backups older than this many days", parseInt)
  .option("--dry-run", "Show what would be deleted without actually deleting")
  .option("-v, --verbose", "Verbose output")
  .action(async (options) => {
    try {
      const config = await loadConfig();
      const backupDir = options.backupDir || config.backupDir;
      const keepCount = options.keep ?? config.retention.minKeep;
      const retentionDays = options.days || config.retention.days;

      const manifests = await listManifests(backupDir);

      if (manifests.length === 0) {
        console.log("No backups found.");
        return;
      }

      let toDelete: Array<{ manifest: typeof manifests[0]; reason?: string }> = [];
      let toKeep: typeof manifests = [];

      // Use GFS retention when enabled, otherwise use age-based retention
      if (config.retention.gfs?.enabled) {
        // GFS (Grandfather-Father-Son) tiered retention
        const backupsToPrune = getBackupsToPrune(
          manifests,
          config.retention.gfs,
          keepCount
        );
        toDelete = backupsToPrune.map((t) => ({ manifest: t.manifest, reason: t.tierReason }));
        toKeep = manifests.filter((m) => !toDelete.some((d) => d.manifest.id === m.id));

        if (options.verbose) {
          console.log(`Using GFS retention (daily=${config.retention.gfs.daily}, weekly=${config.retention.gfs.weekly}, monthly=${config.retention.gfs.monthly})`);
        }
      } else {
        // Age-based retention (legacy behavior)
        const now = Date.now();
        const cutoffDate = now - retentionDays * 24 * 60 * 60 * 1000;

        for (const manifest of manifests) {
          const manifestDate = new Date(manifest.timestamp).getTime();

          if (toKeep.length < keepCount) {
            // Always keep minimum number
            toKeep.push(manifest);
          } else if (manifestDate >= cutoffDate) {
            // Keep if within retention period
            toKeep.push(manifest);
          } else {
            // Delete if older than retention and we have enough
            toDelete.push({ manifest, reason: `older than ${retentionDays} days` });
          }
        }
      }

      if (toDelete.length === 0) {
        console.log("No backups to prune.");
        return;
      }

      console.log(`${options.dryRun ? "[DRY RUN] " : ""}Pruning ${toDelete.length} backup(s):`);

      for (const { manifest, reason } of toDelete) {
        const date = new Date(manifest.timestamp).toLocaleString();
        const reasonSuffix = reason ? ` - ${reason}` : "";
        console.log(`  ${manifest.id} (${date})${reasonSuffix}`);

        if (!options.dryRun) {
          const backupPath = join(backupDir, manifest.id);
          await Bun.$`rm -rf ${backupPath}`.quiet();
        }
      }

      if (options.dryRun) {
        console.log(`\n(Use without --dry-run to actually delete)`);
      } else {
        console.log(`\n✅ Deleted ${toDelete.length} backup(s)`);
      }

      console.log(`Keeping ${toKeep.length} backup(s)`);
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

// Helper function to format bytes
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

// Parse and run
program.parse();
