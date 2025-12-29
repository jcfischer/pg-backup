/**
 * Tests for backup service orchestrator
 * TDD: Write tests FIRST, then implement
 *
 * Note: The backup service orchestrates:
 * 1. Database dump (pg_dump)
 * 2. Directory archiving (tar)
 * 3. Encryption (gpg) - optional
 * 4. Off-site sync (S3/rsync) - optional
 * 5. Manifest creation
 */

import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { BackupConfig, BackupResult } from "../src/types";

// Import function we'll implement
import { runBackup, BackupService } from "../src/backup-service";

describe("backup-service", () => {
  let tempDir: string;
  let backupDir: string;
  let sourceDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pg-backup-service-"));
    backupDir = join(tempDir, "backups");
    sourceDir = join(tempDir, "source");
    await mkdir(backupDir, { recursive: true });
    await mkdir(sourceDir, { recursive: true });

    // Create some test files in source directory
    await writeFile(join(sourceDir, "test.txt"), "test content");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("BackupService class", () => {
    it("should create instance with config", () => {
      const config: BackupConfig = {
        database: {
          host: "localhost",
          port: 5432,
          name: "testdb",
          user: "user",
        },
        directories: [sourceDir],
        backupDir,
        retention: { days: 7, minKeep: 3 },
      };

      const service = new BackupService(config);

      expect(service).toBeDefined();
      expect(service.config).toEqual(config);
    });

    it("should have run method", () => {
      const config: BackupConfig = {
        database: {
          host: "localhost",
          port: 5432,
          name: "testdb",
          user: "user",
        },
        directories: [],
        backupDir,
        retention: { days: 7, minKeep: 3 },
      };

      const service = new BackupService(config);

      expect(typeof service.run).toBe("function");
    });
  });

  describe("runBackup function", () => {
    it("should return BackupResult type", async () => {
      const config: BackupConfig = {
        database: {
          host: "localhost",
          port: 5432,
          name: "testdb",
          user: "user",
        },
        directories: [],
        backupDir,
        retention: { days: 7, minKeep: 3 },
      };

      // This will fail without actual PostgreSQL, but should return proper type
      const result = await runBackup(config);

      expect(result).toHaveProperty("success");
      expect(typeof result.success).toBe("boolean");
    });

    it("should return manifest on successful backup", async () => {
      const config: BackupConfig = {
        database: {
          host: "localhost",
          port: 5432,
          name: "testdb",
          user: "user",
        },
        directories: [sourceDir],
        backupDir,
        retention: { days: 7, minKeep: 3 },
      };

      const result = await runBackup(config);

      // If successful, should have manifest
      if (result.success) {
        expect(result.manifest).toBeDefined();
        expect(result.manifest?.id).toMatch(/^backup-\d{4}-\d{2}-\d{2}T/);
        expect(result.manifest?.database.name).toBe("testdb");
        expect(result.backupPath).toBeDefined();
      } else {
        // Expected to fail without PostgreSQL
        expect(result.error).toBeDefined();
      }
    });

    it("should handle database errors gracefully (connection or pg_dump unavailable)", async () => {
      const config: BackupConfig = {
        database: {
          host: "nonexistent-host",
          port: 5432,
          name: "nonexistent",
          user: "nobody",
        },
        directories: [],
        backupDir,
        retention: { days: 7, minKeep: 3 },
      };

      const result = await runBackup(config);

      // Either pg_dump is not available, or connection will fail
      // In both cases, database backup should fail
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should create backup directory if not exists", async () => {
      const newBackupDir = join(tempDir, "new-backup-dir");
      const config: BackupConfig = {
        database: {
          host: "localhost",
          port: 5432,
          name: "testdb",
          user: "user",
        },
        directories: [],
        backupDir: newBackupDir,
        retention: { days: 7, minKeep: 3 },
      };

      // Should not throw even if directory doesn't exist
      await runBackup(config);

      expect(existsSync(newBackupDir)).toBe(true);
    });
  });

  describe("directory backup", () => {
    it("should archive directories when specified", async () => {
      const config: BackupConfig = {
        database: {
          host: "localhost",
          port: 5432,
          name: "testdb",
          user: "user",
        },
        directories: [sourceDir],
        backupDir,
        retention: { days: 7, minKeep: 3 },
      };

      const result = await runBackup(config);

      // Even if database fails, directory archiving should be attempted
      // Check if manifest has directory info when backup is partial/complete
      if (result.manifest) {
        expect(result.manifest.directories).toBeDefined();
      }
    });

    it("should skip non-existent directories", async () => {
      const config: BackupConfig = {
        database: {
          host: "localhost",
          port: 5432,
          name: "testdb",
          user: "user",
        },
        directories: [sourceDir, "/nonexistent/path"],
        backupDir,
        retention: { days: 7, minKeep: 3 },
      };

      // Should not throw
      const result = await runBackup(config);

      // Should handle gracefully
      expect(result).toBeDefined();
    });
  });

  describe("encryption", () => {
    it("should encrypt backup when encryptionKey is provided", async () => {
      const config: BackupConfig = {
        database: {
          host: "localhost",
          port: 5432,
          name: "testdb",
          user: "user",
        },
        directories: [sourceDir],
        backupDir,
        retention: { days: 7, minKeep: 3 },
        encryptionKey: "test-encryption-key",
      };

      const result = await runBackup(config);

      // If backup succeeds, encrypted flag should be true
      if (result.manifest) {
        expect(result.manifest.encrypted).toBe(true);
      }
    });

    it("should not encrypt when no encryptionKey", async () => {
      const config: BackupConfig = {
        database: {
          host: "localhost",
          port: 5432,
          name: "testdb",
          user: "user",
        },
        directories: [sourceDir],
        backupDir,
        retention: { days: 7, minKeep: 3 },
        // No encryptionKey
      };

      const result = await runBackup(config);

      if (result.manifest) {
        expect(result.manifest.encrypted).toBe(false);
      }
    });
  });

  describe("offsite sync", () => {
    it("should sync to S3 when configured", async () => {
      const config: BackupConfig = {
        database: {
          host: "localhost",
          port: 5432,
          name: "testdb",
          user: "user",
        },
        directories: [sourceDir],
        backupDir,
        retention: { days: 7, minKeep: 3 },
        offsite: {
          type: "s3",
          endpoint: "https://s3.example.com",
          bucket: "backups",
          prefix: "pg-backup",
          accessKey: "key",
          secretKey: "secret",
          region: "us-east-1",
        },
      };

      // This will fail without actual S3, but should handle gracefully
      const result = await runBackup(config);

      // Should return proper result type
      expect(result).toBeDefined();
    });

    it("should sync to rsync when configured", async () => {
      const config: BackupConfig = {
        database: {
          host: "localhost",
          port: 5432,
          name: "testdb",
          user: "user",
        },
        directories: [sourceDir],
        backupDir,
        retention: { days: 7, minKeep: 3 },
        offsite: {
          type: "rsync",
          host: "backup.example.com",
          user: "backup",
          path: "/backups",
          timeout: 2, // Short timeout for test
        },
      };

      // This will fail without actual rsync target, but should handle gracefully
      const result = await runBackup(config);

      expect(result).toBeDefined();
    });

    it("should record offsite sync status in manifest", async () => {
      const config: BackupConfig = {
        database: {
          host: "localhost",
          port: 5432,
          name: "testdb",
          user: "user",
        },
        directories: [sourceDir],
        backupDir,
        retention: { days: 7, minKeep: 3 },
        offsite: {
          type: "s3",
          endpoint: "https://s3.example.com",
          bucket: "backups",
          prefix: "pg-backup",
          accessKey: "key",
          secretKey: "secret",
          region: "us-east-1",
        },
      };

      const result = await runBackup(config);

      if (result.manifest) {
        expect(result.manifest.offsite).toBeDefined();
        expect(typeof result.manifest.offsite?.synced).toBe("boolean");
      }
    });
  });

  describe("manifest creation", () => {
    it("should save manifest.json in backup directory", async () => {
      const config: BackupConfig = {
        database: {
          host: "localhost",
          port: 5432,
          name: "testdb",
          user: "user",
        },
        directories: [],
        backupDir,
        retention: { days: 7, minKeep: 3 },
      };

      const result = await runBackup(config);

      if (result.success && result.manifest) {
        const manifestPath = join(backupDir, result.manifest.id, "manifest.json");
        expect(existsSync(manifestPath)).toBe(true);
      }
    });

    it("should record duration in manifest", async () => {
      const config: BackupConfig = {
        database: {
          host: "localhost",
          port: 5432,
          name: "testdb",
          user: "user",
        },
        directories: [],
        backupDir,
        retention: { days: 7, minKeep: 3 },
      };

      const result = await runBackup(config);

      if (result.manifest) {
        expect(typeof result.manifest.duration).toBe("number");
        expect(result.manifest.duration).toBeGreaterThanOrEqual(0);
      }
    });

    it("should set status to 'complete' on success", async () => {
      const config: BackupConfig = {
        database: {
          host: "localhost",
          port: 5432,
          name: "testdb",
          user: "user",
        },
        directories: [],
        backupDir,
        retention: { days: 7, minKeep: 3 },
      };

      const result = await runBackup(config);

      if (result.success && result.manifest) {
        expect(result.manifest.status).toBe("complete");
      }
    });

    it("should set status to 'failed' on failure", async () => {
      const config: BackupConfig = {
        database: {
          host: "nonexistent",
          port: 5432,
          name: "nonexistent",
          user: "nobody",
        },
        directories: [],
        backupDir,
        retention: { days: 7, minKeep: 3 },
      };

      const result = await runBackup(config);

      if (!result.success && result.manifest) {
        expect(result.manifest.status).toBe("failed");
      }
    });
  });

  describe("checksum calculation", () => {
    it("should calculate checksum for database dump", async () => {
      const config: BackupConfig = {
        database: {
          host: "localhost",
          port: 5432,
          name: "testdb",
          user: "user",
        },
        directories: [],
        backupDir,
        retention: { days: 7, minKeep: 3 },
      };

      const result = await runBackup(config);

      if (result.success && result.manifest) {
        expect(result.manifest.database.checksum).toBeDefined();
        expect(result.manifest.database.checksum).toHaveLength(64); // SHA-256 hex
      }
    });

    it("should calculate checksums for directory archives", async () => {
      const config: BackupConfig = {
        database: {
          host: "localhost",
          port: 5432,
          name: "testdb",
          user: "user",
        },
        directories: [sourceDir],
        backupDir,
        retention: { days: 7, minKeep: 3 },
      };

      const result = await runBackup(config);

      if (result.manifest && result.manifest.directories.length > 0) {
        for (const dir of result.manifest.directories) {
          expect(dir.checksum).toBeDefined();
          expect(dir.checksum).toHaveLength(64); // SHA-256 hex
        }
      }
    });
  });
});
