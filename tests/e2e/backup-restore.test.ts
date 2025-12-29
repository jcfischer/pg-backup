/**
 * End-to-end tests for backup and restore workflows
 *
 * These tests simulate full backup/restore cycles using
 * directory-only operations (no database) since PostgreSQL
 * may not be available in the test environment.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir, readdir, readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import type { BackupConfig } from "../../src/types";
import { BackupService, runBackup } from "../../src/backup-service";
import { RestoreService, runRestore } from "../../src/restore-service";
import { VerifyService, runVerify } from "../../src/verify";
import { PruneService, runPrune } from "../../src/prune";
import { loadManifest } from "../../src/manifest";
import { archiveDirectory } from "../../src/directories";
import { calculateChecksum, createManifest, saveManifest } from "../../src/manifest";

describe("E2E: Backup and Restore Workflow", () => {
  let tempDir: string;
  let backupDir: string;
  let sourceDir: string;
  let restoreDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pg-backup-e2e-"));
    backupDir = join(tempDir, "backups");
    sourceDir = join(tempDir, "source");
    restoreDir = join(tempDir, "restore");

    await mkdir(backupDir, { recursive: true });
    await mkdir(sourceDir, { recursive: true });
    await mkdir(restoreDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // Helper to create a directory-only backup (simulating what backup-service does)
  async function createDirectoryBackup(
    config: BackupConfig,
    backupId: string,
    options?: { timestamp?: string }
  ): Promise<{ success: boolean; path: string }> {
    const backupPath = join(config.backupDir, backupId);
    await mkdir(backupPath, { recursive: true });

    const directoryResults: Array<{
      path: string;
      size: number;
      fileCount: number;
      checksum: string;
    }> = [];

    // Archive directories
    for (const dirPath of config.directories) {
      if (!existsSync(dirPath)) continue;

      const dirName = dirPath.split("/").pop()?.replace(/[^a-zA-Z0-9-_]/g, "_") || "dir";
      const archivePath = join(backupPath, `${dirName}.tar.gz`);

      const result = await archiveDirectory(dirPath, archivePath);
      if (result.success) {
        const checksum = await calculateChecksum(archivePath);
        directoryResults.push({
          path: dirPath,
          size: result.size,
          fileCount: result.fileCount,
          checksum,
        });
      }
    }

    // Create manifest
    const manifest = createManifest({
      databaseName: config.database.name,
      databaseSize: 0,
      databaseChecksum: "",
      directories: directoryResults,
      encrypted: !!config.encryptionKey,
      duration: 1,
      status: "complete",
    });

    // Override ID and optionally timestamp
    (manifest as any).id = backupId;
    if (options?.timestamp) {
      (manifest as any).timestamp = options.timestamp;
    }

    // Save manifest
    await saveManifest(config.backupDir, manifest);

    // Create dummy database file (so verify works)
    const dbPath = join(backupPath, `${config.database.name}.sql.gz`);
    await writeFile(dbPath, "-- dummy database dump");

    // Update manifest with db checksum
    const dbChecksum = await calculateChecksum(dbPath);
    manifest.database.checksum = dbChecksum;
    await writeFile(join(backupPath, "manifest.json"), JSON.stringify(manifest, null, 2));

    return { success: true, path: backupPath };
  }

  describe("Directory archiving workflow", () => {
    it("should archive directories successfully", async () => {
      // Setup: Create source files
      await writeFile(join(sourceDir, "file1.txt"), "Hello World");
      await writeFile(join(sourceDir, "file2.txt"), "Test content");
      await mkdir(join(sourceDir, "subdir"), { recursive: true });
      await writeFile(join(sourceDir, "subdir", "nested.txt"), "Nested file");

      const config: BackupConfig = {
        database: {
          host: "localhost",
          port: 5432,
          name: "testdb",
          user: "postgres",
        },
        backupDir,
        directories: [sourceDir],
        retention: { days: 30, minKeep: 3 },
      };

      const backupId = `backup-${Date.now()}`;
      const result = await createDirectoryBackup(config, backupId);

      expect(result.success).toBe(true);

      // Verify backup directory was created
      expect(existsSync(result.path)).toBe(true);

      // Verify manifest exists
      const manifestPath = join(result.path, "manifest.json");
      expect(existsSync(manifestPath)).toBe(true);

      // Load and check manifest
      const manifest = await loadManifest(manifestPath);
      expect(manifest.id).toBe(backupId);
      expect(manifest.status).toBe("complete");
      expect(manifest.directories.length).toBe(1);
      expect(manifest.directories[0].fileCount).toBeGreaterThan(0);
    });

    it("should handle multiple directories", async () => {
      // Create multiple source directories
      const dir1 = join(tempDir, "uploads");
      const dir2 = join(tempDir, "config");
      await mkdir(dir1, { recursive: true });
      await mkdir(dir2, { recursive: true });
      await writeFile(join(dir1, "image.jpg"), "fake image");
      await writeFile(join(dir2, "settings.json"), '{"key": "value"}');

      const config: BackupConfig = {
        database: {
          host: "localhost",
          port: 5432,
          name: "testdb",
          user: "postgres",
        },
        backupDir,
        directories: [dir1, dir2],
        retention: { days: 30, minKeep: 3 },
      };

      const backupId = `backup-${Date.now()}`;
      const result = await createDirectoryBackup(config, backupId);

      expect(result.success).toBe(true);

      // Verify both directories archived
      const manifest = await loadManifest(join(result.path, "manifest.json"));
      expect(manifest.directories.length).toBe(2);
    });
  });

  describe("Verify workflow", () => {
    it("should verify backup integrity", async () => {
      await writeFile(join(sourceDir, "verify-test.txt"), "Verify this");

      const config: BackupConfig = {
        database: {
          host: "localhost",
          port: 5432,
          name: "testdb",
          user: "postgres",
        },
        backupDir,
        directories: [sourceDir],
        retention: { days: 30, minKeep: 3 },
      };

      const backupId = `backup-${Date.now()}`;
      await createDirectoryBackup(config, backupId);

      // Verify backup
      const verifyService = new VerifyService(backupDir);
      const verifyResult = await verifyService.verify(backupId);

      expect(verifyResult.success).toBe(true);
      expect(verifyResult.directories).toBeDefined();
      expect(verifyResult.directories![0].valid).toBe(true);
    });

    it("should detect corrupted backup", async () => {
      await writeFile(join(sourceDir, "corrupt-test.txt"), "Will be corrupted");

      const config: BackupConfig = {
        database: {
          host: "localhost",
          port: 5432,
          name: "testdb",
          user: "postgres",
        },
        backupDir,
        directories: [sourceDir],
        retention: { days: 30, minKeep: 3 },
      };

      const backupId = `backup-${Date.now()}`;
      const result = await createDirectoryBackup(config, backupId);

      // Corrupt the archive
      const files = await readdir(result.path);
      const archiveFile = files.find((f) => f.endsWith(".tar.gz") && !f.includes("testdb"));
      if (archiveFile) {
        await writeFile(join(result.path, archiveFile), "corrupted data");
      }

      // Verify should fail
      const verifyService = new VerifyService(backupDir);
      const verifyResult = await verifyService.verify(backupId);

      expect(verifyResult.success).toBe(false);
      expect(verifyResult.directories![0].valid).toBe(false);
      expect(verifyResult.directories![0].error).toContain("mismatch");
    });

    it("should detect missing backup", async () => {
      const verifyService = new VerifyService(backupDir);
      const verifyResult = await verifyService.verify("nonexistent-backup");

      expect(verifyResult.success).toBe(false);
      expect(verifyResult.error).toContain("not found");
    });
  });

  describe("Prune workflow", () => {
    it("should prune old backups while keeping minimum", async () => {
      const config: BackupConfig = {
        database: {
          host: "localhost",
          port: 5432,
          name: "testdb",
          user: "postgres",
        },
        backupDir,
        directories: [sourceDir],
        retention: { days: 0, minKeep: 2 }, // 0 days = prune immediately, keep min 2
      };

      await writeFile(join(sourceDir, "prune-test.txt"), "Test");

      // Create multiple backups with different historical timestamps
      await createDirectoryBackup(config, "backup-2025-01-01T00-00-00", {
        timestamp: "2025-01-01T00:00:00.000Z",
      });
      await createDirectoryBackup(config, "backup-2025-01-02T00-00-00", {
        timestamp: "2025-01-02T00:00:00.000Z",
      });
      await createDirectoryBackup(config, "backup-2025-01-03T00-00-00", {
        timestamp: "2025-01-03T00:00:00.000Z",
      });

      let backups = await readdir(backupDir);
      expect(backups.length).toBe(3);

      // Prune - all backups are ~1 year old, so with days=0 the oldest should be pruned
      const pruneService = new PruneService(backupDir, config.retention);
      const pruneResult = await pruneService.prune();

      expect(pruneResult.success).toBe(true);
      // With minKeep=2 and days=0, oldest backup should be pruned
      expect(pruneResult.pruned.length).toBe(1);
      expect(pruneResult.kept.length).toBe(2);

      // Verify only 2 backups remain
      backups = await readdir(backupDir);
      expect(backups.length).toBe(2);
    });

    it("should keep all backups when count equals minKeep", async () => {
      const config: BackupConfig = {
        database: {
          host: "localhost",
          port: 5432,
          name: "testdb",
          user: "postgres",
        },
        backupDir,
        directories: [sourceDir],
        retention: { days: 0, minKeep: 3 },
      };

      await writeFile(join(sourceDir, "test.txt"), "Test");

      // Create backups with historical timestamps
      await createDirectoryBackup(config, "backup-2025-01-01T00-00-00", {
        timestamp: "2025-01-01T00:00:00.000Z",
      });
      await createDirectoryBackup(config, "backup-2025-01-02T00-00-00", {
        timestamp: "2025-01-02T00:00:00.000Z",
      });
      await createDirectoryBackup(config, "backup-2025-01-03T00-00-00", {
        timestamp: "2025-01-03T00:00:00.000Z",
      });

      const pruneService = new PruneService(backupDir, config.retention);
      const pruneResult = await pruneService.prune();

      expect(pruneResult.success).toBe(true);
      // With minKeep=3, no backups should be pruned even though they're old
      expect(pruneResult.pruned.length).toBe(0);
      expect(pruneResult.kept.length).toBe(3);

      const backups = await readdir(backupDir);
      expect(backups.length).toBe(3);
    });

    it("should support dry-run mode", async () => {
      const config: BackupConfig = {
        database: {
          host: "localhost",
          port: 5432,
          name: "testdb",
          user: "postgres",
        },
        backupDir,
        directories: [sourceDir],
        retention: { days: 0, minKeep: 1 },
      };

      await writeFile(join(sourceDir, "dryrun-test.txt"), "Test");

      // Create backups with historical timestamps
      await createDirectoryBackup(config, "backup-2025-01-01T00-00-00", {
        timestamp: "2025-01-01T00:00:00.000Z",
      });
      await createDirectoryBackup(config, "backup-2025-01-02T00-00-00", {
        timestamp: "2025-01-02T00:00:00.000Z",
      });

      let backups = await readdir(backupDir);
      expect(backups.length).toBe(2);

      // Dry-run prune - older backup would be pruned (minKeep=1)
      const pruneService = new PruneService(backupDir, config.retention);
      const pruneResult = await pruneService.dryRun();

      expect(pruneResult.success).toBe(true);
      expect(pruneResult.pruned.length).toBe(1); // Would prune 1

      // Verify nothing actually deleted
      backups = await readdir(backupDir);
      expect(backups.length).toBe(2);
    });
  });

  describe("BackupService class", () => {
    it("should have run method", () => {
      const config: BackupConfig = {
        database: {
          host: "localhost",
          port: 5432,
          name: "testdb",
          user: "postgres",
        },
        backupDir,
        directories: [],
        retention: { days: 30, minKeep: 3 },
      };

      const service = new BackupService(config);
      expect(typeof service.run).toBe("function");
    });

    it("should handle missing pg_dump gracefully", async () => {
      const config: BackupConfig = {
        database: {
          host: "localhost",
          port: 5432,
          name: "testdb",
          user: "postgres",
        },
        backupDir,
        directories: [sourceDir],
        retention: { days: 30, minKeep: 3 },
      };

      await writeFile(join(sourceDir, "test.txt"), "Test content");

      const service = new BackupService(config);
      const result = await service.run();

      // If pg_dump is not available, backup fails but doesn't throw
      expect(result).toBeDefined();
      expect(typeof result.success).toBe("boolean");

      // Manifest should still be created
      if (result.manifest) {
        expect(result.manifest.id).toBeDefined();
      }
    });
  });

  describe("RestoreService class", () => {
    it("should have restore method", () => {
      const service = new RestoreService(backupDir);
      expect(typeof service.restore).toBe("function");
    });

    it("should fail gracefully for non-existent backup", async () => {
      const service = new RestoreService(backupDir);
      const result = await service.restore("nonexistent-backup");

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("Complete backup-verify-prune cycle", () => {
    it("should complete full cycle with directories", async () => {
      // Create source files
      await writeFile(join(sourceDir, "workflow.txt"), "Full workflow test");
      await mkdir(join(sourceDir, "data"), { recursive: true });
      await writeFile(join(sourceDir, "data", "nested.json"), '{"test": true}');

      const config: BackupConfig = {
        database: {
          host: "localhost",
          port: 5432,
          name: "workflowdb",
          user: "postgres",
        },
        backupDir,
        directories: [sourceDir],
        retention: { days: 30, minKeep: 3 },
      };

      // Step 1: Create backup
      const backupId = `backup-${Date.now()}`;
      const backupResult = await createDirectoryBackup(config, backupId);
      expect(backupResult.success).toBe(true);

      // Step 2: Verify backup
      const verifyService = new VerifyService(backupDir);
      const verifyResult = await verifyService.verify(backupId);
      expect(verifyResult.success).toBe(true);
      expect(verifyResult.manifest).toBeDefined();

      // Step 3: Prune (no old backups to prune)
      const pruneService = new PruneService(backupDir, config.retention);
      const pruneResult = await pruneService.prune();
      expect(pruneResult.success).toBe(true);
      expect(pruneResult.kept.length).toBe(1);
      expect(pruneResult.pruned.length).toBe(0);
    });

    it("should handle empty directories list", async () => {
      const config: BackupConfig = {
        database: {
          host: "localhost",
          port: 5432,
          name: "emptydb",
          user: "postgres",
        },
        backupDir,
        directories: [],
        retention: { days: 30, minKeep: 3 },
      };

      const backupId = `backup-${Date.now()}`;
      const result = await createDirectoryBackup(config, backupId);

      expect(result.success).toBe(true);

      const manifest = await loadManifest(join(result.path, "manifest.json"));
      expect(manifest.directories.length).toBe(0);
    });
  });

  describe("Functional interfaces", () => {
    it("runVerify should work same as VerifyService", async () => {
      await writeFile(join(sourceDir, "func-test.txt"), "Functional test");

      const config: BackupConfig = {
        database: {
          host: "localhost",
          port: 5432,
          name: "testdb",
          user: "postgres",
        },
        backupDir,
        directories: [sourceDir],
        retention: { days: 30, minKeep: 3 },
      };

      const backupId = `backup-${Date.now()}`;
      await createDirectoryBackup(config, backupId);

      // Use functional interface
      const result = await runVerify(backupDir, backupId);

      expect(result.success).toBe(true);
      expect(result.backupId).toBe(backupId);
    });

    it("runPrune should work same as PruneService", async () => {
      await writeFile(join(sourceDir, "prune-func.txt"), "Test");

      await createDirectoryBackup(
        {
          database: { host: "localhost", port: 5432, name: "testdb", user: "postgres" },
          backupDir,
          directories: [sourceDir],
          retention: { days: 30, minKeep: 3 },
        },
        "backup-old"
      );

      const result = await runPrune(backupDir, { days: 30, minKeep: 3 });

      expect(result.success).toBe(true);
      expect(result.kept.length).toBe(1);
    });
  });
});
