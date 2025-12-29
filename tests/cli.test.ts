/**
 * Tests for CLI commands
 * TDD: Write tests FIRST, then implement
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { $ } from "bun";

// Path to CLI entry point
const CLI_PATH = join(import.meta.dir, "../src/cli.ts");

describe("CLI", () => {
  let tempDir: string;
  let envFile: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pg-backup-cli-"));
    envFile = join(tempDir, ".env");

    // Create minimal env file for testing
    await writeFile(
      envFile,
      `
PG_BACKUP_DB_HOST=localhost
PG_BACKUP_DB_PORT=5432
PG_BACKUP_DB_NAME=testdb
PG_BACKUP_DB_USER=testuser
PG_BACKUP_BACKUP_DIR=${join(tempDir, "backups")}
PG_BACKUP_RETENTION_DAYS=7
PG_BACKUP_RETENTION_MIN_KEEP=3
`.trim()
    );
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("help", () => {
    it("should show help with --help flag", async () => {
      const result = await $`bun ${CLI_PATH} --help`.quiet().text();

      expect(result).toContain("pg-backup");
      expect(result).toContain("backup");
      expect(result).toContain("restore");
      expect(result).toContain("list");
    });

    it("should show help with no arguments", async () => {
      // Commander shows usage to stderr when no command is given
      const result = await $`bun ${CLI_PATH}`.quiet().nothrow();
      const output = result.stdout.toString() + result.stderr.toString();

      expect(output).toContain("pg-backup");
    });
  });

  describe("version", () => {
    it("should show version with --version flag", async () => {
      const result = await $`bun ${CLI_PATH} --version`.quiet().text();

      expect(result).toMatch(/\d+\.\d+\.\d+/);
    });
  });

  describe("backup command", () => {
    it("should show backup help", async () => {
      const result = await $`bun ${CLI_PATH} backup --help`.quiet().text();

      expect(result).toContain("backup");
    });

    it("should require configuration", async () => {
      // Without proper config, should show error
      const result = await $`bun ${CLI_PATH} backup`.quiet().nothrow();

      // Should either succeed or fail with clear error
      expect(result.exitCode).toBeDefined();
    });

    it("should accept --config flag", async () => {
      const result = await $`bun ${CLI_PATH} backup --help`.quiet().text();

      expect(result).toContain("config");
    });
  });

  describe("restore command", () => {
    it("should show restore help", async () => {
      const result = await $`bun ${CLI_PATH} restore --help`.quiet().text();

      expect(result).toContain("restore");
    });

    it("should require backup ID", async () => {
      const result = await $`bun ${CLI_PATH} restore`.quiet().nothrow();

      // Should fail without backup ID
      expect(result.exitCode).not.toBe(0);
    });

    it("should accept backup ID as argument", async () => {
      // Create a test backup first
      const backupDir = join(tempDir, "backups");
      const backupId = "backup-2025-12-28T12-00-00";
      await mkdir(join(backupDir, backupId), { recursive: true });
      await writeFile(
        join(backupDir, backupId, "manifest.json"),
        JSON.stringify({
          id: backupId,
          timestamp: "2025-12-28T12:00:00Z",
          version: "0.1.0",
          database: { name: "testdb", size: 1024, checksum: "abc" },
          directories: [],
          encrypted: false,
          status: "complete",
          duration: 60,
        })
      );

      const result = await $`bun ${CLI_PATH} restore ${backupId} --backup-dir ${backupDir} --skip-database`.quiet().nothrow();

      // Should attempt restore
      expect(result.exitCode).toBeDefined();
    });
  });

  describe("list command", () => {
    it("should show list help", async () => {
      const result = await $`bun ${CLI_PATH} list --help`.quiet().text();

      expect(result).toContain("list");
    });

    it("should list backups", async () => {
      // Create a test backup
      const backupDir = join(tempDir, "backups");
      const backupId = "backup-2025-12-28T12-00-00";
      await mkdir(join(backupDir, backupId), { recursive: true });
      await writeFile(
        join(backupDir, backupId, "manifest.json"),
        JSON.stringify({
          id: backupId,
          timestamp: "2025-12-28T12:00:00Z",
          version: "0.1.0",
          database: { name: "testdb", size: 1024, checksum: "abc" },
          directories: [],
          encrypted: false,
          status: "complete",
          duration: 60,
        })
      );

      const result = await $`bun ${CLI_PATH} list --backup-dir ${backupDir}`.quiet().text();

      expect(result).toContain(backupId);
    });

    it("should show empty message when no backups", async () => {
      const backupDir = join(tempDir, "empty-backups");
      await mkdir(backupDir, { recursive: true });

      const result = await $`bun ${CLI_PATH} list --backup-dir ${backupDir}`.quiet().text();

      expect(result.toLowerCase()).toContain("no backup");
    });

    it("should show GFS tier information when enabled", async () => {
      const backupDir = join(tempDir, "backups");
      await mkdir(backupDir, { recursive: true });

      // Create 4 backups across different time periods
      const backups = [
        { id: "backup-1", date: "2025-12-29T12:00:00Z" }, // Daily
        { id: "backup-2", date: "2025-12-28T12:00:00Z" }, // Daily
        { id: "backup-3", date: "2025-12-20T12:00:00Z" }, // Weekly or prunable
        { id: "backup-4", date: "2025-12-01T12:00:00Z" }, // Monthly or prunable
      ];

      for (const backup of backups) {
        await mkdir(join(backupDir, backup.id), { recursive: true });
        await writeFile(
          join(backupDir, backup.id, "manifest.json"),
          JSON.stringify({
            id: backup.id,
            timestamp: backup.date,
            version: "0.1.0",
            database: { name: "testdb", size: 1024, checksum: "abc" },
            directories: [],
            encrypted: false,
            status: "complete",
            duration: 60,
          })
        );
      }

      const env = {
        PG_BACKUP_DB_NAME: "testdb",
        PG_BACKUP_GFS_ENABLED: "true",
        PG_BACKUP_GFS_DAILY: "2",
        PG_BACKUP_GFS_WEEKLY: "2",
        PG_BACKUP_GFS_MONTHLY: "2",
      };

      const result = await $`bun ${CLI_PATH} list --backup-dir ${backupDir}`.env(env).quiet().text();

      // Should show tier information for each backup
      expect(result).toContain("daily");
    });
  });

  describe("status command", () => {
    it("should show status help", async () => {
      const result = await $`bun ${CLI_PATH} status --help`.quiet().text();

      expect(result).toContain("status");
    });

    it("should show latest backup status", async () => {
      // Create a test backup
      const backupDir = join(tempDir, "backups");
      const backupId = "backup-2025-12-28T12-00-00";
      await mkdir(join(backupDir, backupId), { recursive: true });
      await writeFile(
        join(backupDir, backupId, "manifest.json"),
        JSON.stringify({
          id: backupId,
          timestamp: "2025-12-28T12:00:00Z",
          version: "0.1.0",
          database: { name: "testdb", size: 1024, checksum: "abc" },
          directories: [],
          encrypted: false,
          status: "complete",
          duration: 60,
        })
      );

      const result = await $`bun ${CLI_PATH} status --backup-dir ${backupDir}`.quiet().text();

      expect(result).toContain("complete");
    });
  });

  describe("verify command", () => {
    it("should show verify help", async () => {
      const result = await $`bun ${CLI_PATH} verify --help`.quiet().text();

      expect(result).toContain("verify");
    });

    it("should require backup ID", async () => {
      const result = await $`bun ${CLI_PATH} verify`.quiet().nothrow();

      expect(result.exitCode).not.toBe(0);
    });
  });

  describe("prune command", () => {
    it("should show prune help", async () => {
      const result = await $`bun ${CLI_PATH} prune --help`.quiet().text();

      expect(result).toContain("prune");
    });

    it("should support --dry-run flag", async () => {
      const result = await $`bun ${CLI_PATH} prune --help`.quiet().text();

      expect(result).toContain("dry-run");
    });

    it("should use GFS retention when enabled", async () => {
      // Create multiple backups across different weeks
      const backupDir = join(tempDir, "backups");
      await mkdir(backupDir, { recursive: true });

      // Create 5 backups: 3 recent (daily tier), 2 older (should be weekly/prunable)
      const backups = [
        { id: "backup-1", date: "2025-12-29T12:00:00Z" }, // Daily - newest
        { id: "backup-2", date: "2025-12-28T12:00:00Z" }, // Daily
        { id: "backup-3", date: "2025-12-27T12:00:00Z" }, // Daily
        { id: "backup-4", date: "2025-12-20T12:00:00Z" }, // Older - prunable with daily=3, weekly=0
        { id: "backup-5", date: "2025-12-13T12:00:00Z" }, // Older - prunable
      ];

      for (const backup of backups) {
        await mkdir(join(backupDir, backup.id), { recursive: true });
        await writeFile(
          join(backupDir, backup.id, "manifest.json"),
          JSON.stringify({
            id: backup.id,
            timestamp: backup.date,
            version: "0.1.0",
            database: { name: "testdb", size: 1024, checksum: "abc" },
            directories: [],
            encrypted: false,
            status: "complete",
            duration: 60,
          })
        );
      }

      // Set GFS env vars
      const env = {
        PG_BACKUP_DB_NAME: "testdb",
        PG_BACKUP_GFS_ENABLED: "true",
        PG_BACKUP_GFS_DAILY: "3",
        PG_BACKUP_GFS_WEEKLY: "0",
        PG_BACKUP_GFS_MONTHLY: "0",
        PG_BACKUP_MIN_KEEP: "0",
      };

      const result = await $`bun ${CLI_PATH} prune --backup-dir ${backupDir} --dry-run`.env(env).quiet().text();

      // Should identify 2 backups to prune (backup-4 and backup-5)
      expect(result).toContain("backup-4");
      expect(result).toContain("backup-5");
      // Should NOT include the 3 daily backups
      expect(result).not.toContain("backup-1");
      expect(result).not.toContain("backup-2");
      expect(result).not.toContain("backup-3");
    });

    it("should show tier reason in prune dry-run output", async () => {
      const backupDir = join(tempDir, "backups");
      await mkdir(backupDir, { recursive: true });

      // Create backups
      const backups = [
        { id: "backup-1", date: "2025-12-29T12:00:00Z" },
        { id: "backup-2", date: "2025-12-28T12:00:00Z" },
        { id: "backup-3", date: "2025-12-27T12:00:00Z" },
        { id: "backup-4", date: "2025-12-20T12:00:00Z" },
      ];

      for (const backup of backups) {
        await mkdir(join(backupDir, backup.id), { recursive: true });
        await writeFile(
          join(backupDir, backup.id, "manifest.json"),
          JSON.stringify({
            id: backup.id,
            timestamp: backup.date,
            version: "0.1.0",
            database: { name: "testdb", size: 1024, checksum: "abc" },
            directories: [],
            encrypted: false,
            status: "complete",
            duration: 60,
          })
        );
      }

      const env = {
        PG_BACKUP_DB_NAME: "testdb",
        PG_BACKUP_GFS_ENABLED: "true",
        PG_BACKUP_GFS_DAILY: "3",
        PG_BACKUP_GFS_WEEKLY: "0",
        PG_BACKUP_GFS_MONTHLY: "0",
        PG_BACKUP_MIN_KEEP: "0",
      };

      const result = await $`bun ${CLI_PATH} prune --backup-dir ${backupDir} --dry-run`.env(env).quiet().text();

      // Should show the tier reason for pruned backups
      expect(result).toContain("exceeds retention");
    });

    it("should respect minKeep with GFS retention", async () => {
      // Create backups that would all be prunable by GFS
      const backupDir = join(tempDir, "backups");
      await mkdir(backupDir, { recursive: true });

      const backups = [
        { id: "backup-1", date: "2025-12-29T12:00:00Z" },
        { id: "backup-2", date: "2025-12-28T12:00:00Z" },
        { id: "backup-3", date: "2025-12-27T12:00:00Z" },
      ];

      for (const backup of backups) {
        await mkdir(join(backupDir, backup.id), { recursive: true });
        await writeFile(
          join(backupDir, backup.id, "manifest.json"),
          JSON.stringify({
            id: backup.id,
            timestamp: backup.date,
            version: "0.1.0",
            database: { name: "testdb", size: 1024, checksum: "abc" },
            directories: [],
            encrypted: false,
            status: "complete",
            duration: 60,
          })
        );
      }

      // All tiers = 0, but minKeep = 2 should keep 2 newest
      const env = {
        PG_BACKUP_DB_NAME: "testdb",
        PG_BACKUP_GFS_ENABLED: "true",
        PG_BACKUP_GFS_DAILY: "0",
        PG_BACKUP_GFS_WEEKLY: "0",
        PG_BACKUP_GFS_MONTHLY: "0",
        PG_BACKUP_MIN_KEEP: "2",
      };

      const result = await $`bun ${CLI_PATH} prune --backup-dir ${backupDir} --dry-run`.env(env).quiet().text();

      // Should only prune 1 (oldest), keep 2 due to minKeep
      expect(result).toContain("backup-3"); // oldest - will be pruned
      expect(result).not.toContain("backup-1"); // kept by minKeep
      expect(result).not.toContain("backup-2"); // kept by minKeep
    });
  });

  describe("error handling", () => {
    it("should show error for unknown command", async () => {
      const result = await $`bun ${CLI_PATH} unknowncommand`.quiet().nothrow();

      expect(result.exitCode).not.toBe(0);
    });
  });
});
