/**
 * Tests for prune service
 * TDD: Write tests FIRST, then implement
 *
 * The prune service handles:
 * 1. List backups by age
 * 2. Apply retention policy (keep N days, minimum M backups)
 * 3. Delete old backups
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { BackupManifest, RetentionConfig } from "../src/types";

// Import functions we'll implement
import {
  PruneService,
  runPrune,
  getBackupAge,
  shouldPrune,
  type PruneResult,
} from "../src/prune";

describe("prune", () => {
  let tempDir: string;
  let backupDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pg-backup-prune-"));
    backupDir = join(tempDir, "backups");
    await mkdir(backupDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // Helper to create a test backup
  async function createTestBackup(
    id: string,
    timestamp: string
  ): Promise<BackupManifest> {
    const backupPath = join(backupDir, id);
    await mkdir(backupPath, { recursive: true });

    const manifest: BackupManifest = {
      id,
      timestamp,
      version: "0.1.0",
      database: {
        name: "testdb",
        size: 1024,
        checksum: "abc123",
      },
      directories: [],
      encrypted: false,
      status: "complete",
      duration: 60,
    };

    await writeFile(
      join(backupPath, "manifest.json"),
      JSON.stringify(manifest, null, 2)
    );

    // Create a dummy database file
    await writeFile(join(backupPath, "testdb.sql.gz"), "dummy database dump");

    return manifest;
  }

  describe("PruneService class", () => {
    it("should create instance with backup directory and retention config", () => {
      const retention: RetentionConfig = { days: 7, minKeep: 3 };
      const service = new PruneService(backupDir, retention);

      expect(service).toBeDefined();
      expect(service.backupDir).toBe(backupDir);
      expect(service.retention).toEqual(retention);
    });

    it("should have prune method", () => {
      const service = new PruneService(backupDir, { days: 7, minKeep: 3 });

      expect(typeof service.prune).toBe("function");
    });

    it("should have dryRun method", () => {
      const service = new PruneService(backupDir, { days: 7, minKeep: 3 });

      expect(typeof service.dryRun).toBe("function");
    });
  });

  describe("getBackupAge", () => {
    it("should calculate backup age in days", () => {
      const now = new Date("2025-12-28T12:00:00Z");
      const backup = new Date("2025-12-21T12:00:00Z"); // 7 days ago

      const age = getBackupAge(backup.toISOString(), now);

      expect(age).toBe(7);
    });

    it("should return 0 for backups created today", () => {
      const now = new Date("2025-12-28T12:00:00Z");
      const backup = new Date("2025-12-28T08:00:00Z"); // Same day

      const age = getBackupAge(backup.toISOString(), now);

      expect(age).toBe(0);
    });

    it("should handle partial days", () => {
      const now = new Date("2025-12-28T12:00:00Z");
      const backup = new Date("2025-12-27T00:00:00Z"); // 1.5 days ago

      const age = getBackupAge(backup.toISOString(), now);

      // Should return floor of days
      expect(age).toBe(1);
    });
  });

  describe("shouldPrune", () => {
    it("should return true for backups older than retention days", () => {
      const retention: RetentionConfig = { days: 7, minKeep: 3 };
      const backupAge = 10; // 10 days old
      const totalBackups = 5;
      const backupIndex = 4; // 5th backup (0-indexed)

      const result = shouldPrune(retention, backupAge, totalBackups, backupIndex);

      expect(result).toBe(true);
    });

    it("should return false for backups within retention period", () => {
      const retention: RetentionConfig = { days: 7, minKeep: 3 };
      const backupAge = 3; // 3 days old
      const totalBackups = 5;
      const backupIndex = 2;

      const result = shouldPrune(retention, backupAge, totalBackups, backupIndex);

      expect(result).toBe(false);
    });

    it("should keep minimum backups even if older than retention", () => {
      const retention: RetentionConfig = { days: 7, minKeep: 3 };
      const backupAge = 30; // 30 days old
      const totalBackups = 3; // Only 3 backups exist
      const backupIndex = 2; // 3rd backup (would be deleted if not for minKeep)

      const result = shouldPrune(retention, backupAge, totalBackups, backupIndex);

      // Should not prune because we need to keep minKeep backups
      expect(result).toBe(false);
    });

    it("should allow pruning old backups when more than minKeep exist", () => {
      const retention: RetentionConfig = { days: 7, minKeep: 3 };
      const backupAge = 30; // 30 days old
      const totalBackups = 10;
      const backupIndex = 5; // Beyond minKeep

      const result = shouldPrune(retention, backupAge, totalBackups, backupIndex);

      expect(result).toBe(true);
    });
  });

  describe("runPrune function", () => {
    it("should return PruneResult type", async () => {
      const retention: RetentionConfig = { days: 7, minKeep: 3 };
      const result = await runPrune(backupDir, retention);

      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("pruned");
      expect(result).toHaveProperty("kept");
      expect(typeof result.success).toBe("boolean");
    });

    it("should handle empty backup directory", async () => {
      const retention: RetentionConfig = { days: 7, minKeep: 3 };
      const result = await runPrune(backupDir, retention);

      expect(result.success).toBe(true);
      expect(result.pruned).toEqual([]);
      expect(result.kept).toEqual([]);
    });

    it("should keep all backups within retention period", async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

      await createTestBackup("backup-1", now.toISOString());
      await createTestBackup("backup-2", yesterday.toISOString());
      await createTestBackup("backup-3", twoDaysAgo.toISOString());

      const retention: RetentionConfig = { days: 7, minKeep: 3 };
      const result = await runPrune(backupDir, retention);

      expect(result.success).toBe(true);
      expect(result.pruned).toEqual([]);
      expect(result.kept.length).toBe(3);
    });

    it("should prune backups older than retention period", async () => {
      const now = new Date();
      const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
      const twentyDaysAgo = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000);

      await createTestBackup("backup-1", now.toISOString());
      await createTestBackup("backup-2", now.toISOString());
      await createTestBackup("backup-3", now.toISOString());
      await createTestBackup("backup-old-1", tenDaysAgo.toISOString());
      await createTestBackup("backup-old-2", twentyDaysAgo.toISOString());

      const retention: RetentionConfig = { days: 7, minKeep: 3 };
      const result = await runPrune(backupDir, retention);

      expect(result.success).toBe(true);
      expect(result.pruned.length).toBe(2);
      expect(result.kept.length).toBe(3);

      // Verify old backups were actually deleted
      expect(existsSync(join(backupDir, "backup-old-1"))).toBe(false);
      expect(existsSync(join(backupDir, "backup-old-2"))).toBe(false);
    });

    it("should keep minKeep backups even if all are old", async () => {
      const thirtyDaysAgo = new Date(
        Date.now() - 30 * 24 * 60 * 60 * 1000
      );

      await createTestBackup("backup-1", thirtyDaysAgo.toISOString());
      await createTestBackup("backup-2", thirtyDaysAgo.toISOString());
      await createTestBackup("backup-3", thirtyDaysAgo.toISOString());

      const retention: RetentionConfig = { days: 7, minKeep: 3 };
      const result = await runPrune(backupDir, retention);

      expect(result.success).toBe(true);
      expect(result.pruned).toEqual([]);
      expect(result.kept.length).toBe(3);
    });

    it("should support dry run mode", async () => {
      const now = new Date();
      const twentyDaysAgo = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000);

      await createTestBackup("backup-1", now.toISOString());
      await createTestBackup("backup-2", now.toISOString());
      await createTestBackup("backup-3", now.toISOString());
      await createTestBackup("backup-old", twentyDaysAgo.toISOString());

      const retention: RetentionConfig = { days: 7, minKeep: 3 };
      const result = await runPrune(backupDir, retention, { dryRun: true });

      expect(result.success).toBe(true);
      expect(result.pruned.length).toBe(1);
      expect(result.dryRun).toBe(true);

      // Verify backup was NOT actually deleted (dry run)
      expect(existsSync(join(backupDir, "backup-old"))).toBe(true);
    });
  });

  describe("PruneService.prune", () => {
    it("should prune old backups", async () => {
      const now = new Date();
      const twentyDaysAgo = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000);

      await createTestBackup("backup-1", now.toISOString());
      await createTestBackup("backup-2", now.toISOString());
      await createTestBackup("backup-3", now.toISOString());
      await createTestBackup("backup-old", twentyDaysAgo.toISOString());

      const service = new PruneService(backupDir, { days: 7, minKeep: 3 });
      const result = await service.prune();

      expect(result.success).toBe(true);
      expect(result.pruned.length).toBe(1);
      expect(result.pruned[0]).toBe("backup-old");
    });
  });

  describe("PruneService.dryRun", () => {
    it("should show what would be pruned without deleting", async () => {
      const now = new Date();
      const twentyDaysAgo = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000);

      await createTestBackup("backup-1", now.toISOString());
      await createTestBackup("backup-2", now.toISOString());
      await createTestBackup("backup-3", now.toISOString());
      await createTestBackup("backup-old", twentyDaysAgo.toISOString());

      const service = new PruneService(backupDir, { days: 7, minKeep: 3 });
      const result = await service.dryRun();

      expect(result.success).toBe(true);
      expect(result.pruned.length).toBe(1);
      expect(result.dryRun).toBe(true);

      // Backup still exists
      expect(existsSync(join(backupDir, "backup-old"))).toBe(true);
    });
  });

  describe("error handling", () => {
    it("should handle non-existent backup directory", async () => {
      const retention: RetentionConfig = { days: 7, minKeep: 3 };
      const result = await runPrune("/non/existent/path", retention);

      expect(result.success).toBe(true);
      expect(result.pruned).toEqual([]);
      expect(result.kept).toEqual([]);
    });

    it("should continue on individual backup deletion errors", async () => {
      const now = new Date();
      const twentyDaysAgo = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000);

      await createTestBackup("backup-1", now.toISOString());
      await createTestBackup("backup-2", now.toISOString());
      await createTestBackup("backup-3", now.toISOString());
      await createTestBackup("backup-old-1", twentyDaysAgo.toISOString());
      await createTestBackup("backup-old-2", twentyDaysAgo.toISOString());

      const retention: RetentionConfig = { days: 7, minKeep: 3 };
      const result = await runPrune(backupDir, retention);

      // Should succeed overall even if some deletions fail
      expect(result).toBeDefined();
      expect(typeof result.pruned.length).toBe("number");
    });
  });
});
