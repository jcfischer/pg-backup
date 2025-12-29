/**
 * Tests for verify service
 * TDD: Write tests FIRST, then implement
 *
 * The verify service handles:
 * 1. Load backup manifest
 * 2. Verify database dump checksum
 * 3. Verify directory archive checksums
 * 4. Report verification status
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { $ } from "bun";
import type { BackupManifest } from "../src/types";
import { calculateChecksum } from "../src/manifest";

// Import functions we'll implement
import {
  VerifyService,
  runVerify,
  type VerifyResult,
  type VerifyItemResult,
} from "../src/verify";

describe("verify", () => {
  let tempDir: string;
  let backupDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pg-backup-verify-"));
    backupDir = join(tempDir, "backups");
    await mkdir(backupDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // Helper to create a valid test backup with proper checksums
  async function createValidBackup(id: string): Promise<BackupManifest> {
    const backupPath = join(backupDir, id);
    await mkdir(backupPath, { recursive: true });

    // Create database dump
    const dbContent = "-- PostgreSQL database dump\nCREATE TABLE test;";
    const dbPath = join(backupPath, "testdb.sql.gz");
    await $`echo ${dbContent} | gzip > ${dbPath}`.quiet();
    const dbChecksum = await calculateChecksum(dbPath);

    // Create directory archive
    const sourceDir = join(tempDir, "source");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, "file.txt"), "test content");

    const archivePath = join(backupPath, "source.tar.gz");
    await $`tar -czf ${archivePath} -C ${tempDir} source`.quiet();
    const archiveChecksum = await calculateChecksum(archivePath);

    const manifest: BackupManifest = {
      id,
      timestamp: new Date().toISOString(),
      version: "0.1.0",
      database: {
        name: "testdb",
        size: 1024,
        checksum: dbChecksum,
      },
      directories: [
        {
          path: "/original/source",
          size: 100,
          fileCount: 1,
          checksum: archiveChecksum,
        },
      ],
      encrypted: false,
      status: "complete",
      duration: 60,
    };

    await writeFile(
      join(backupPath, "manifest.json"),
      JSON.stringify(manifest, null, 2)
    );

    return manifest;
  }

  // Helper to create a backup with invalid checksums
  async function createCorruptBackup(id: string): Promise<BackupManifest> {
    const backupPath = join(backupDir, id);
    await mkdir(backupPath, { recursive: true });

    // Create database dump
    const dbContent = "-- PostgreSQL database dump";
    const dbPath = join(backupPath, "testdb.sql.gz");
    await $`echo ${dbContent} | gzip > ${dbPath}`.quiet();

    const manifest: BackupManifest = {
      id,
      timestamp: new Date().toISOString(),
      version: "0.1.0",
      database: {
        name: "testdb",
        size: 1024,
        checksum: "invalid-checksum-12345", // Wrong checksum
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

    return manifest;
  }

  describe("VerifyService class", () => {
    it("should create instance with backup directory", () => {
      const service = new VerifyService(backupDir);

      expect(service).toBeDefined();
      expect(service.backupDir).toBe(backupDir);
    });

    it("should have verify method", () => {
      const service = new VerifyService(backupDir);

      expect(typeof service.verify).toBe("function");
    });
  });

  describe("runVerify function", () => {
    it("should return VerifyResult type", async () => {
      const result = await runVerify(backupDir, "nonexistent-backup");

      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("backupId");
      expect(typeof result.success).toBe("boolean");
    });

    it("should fail for non-existent backup", async () => {
      const result = await runVerify(backupDir, "nonexistent-backup");

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should verify valid backup successfully", async () => {
      const manifest = await createValidBackup("backup-valid");

      const result = await runVerify(backupDir, "backup-valid");

      expect(result.success).toBe(true);
      expect(result.backupId).toBe("backup-valid");
      expect(result.database?.valid).toBe(true);
    });

    it("should detect corrupt database dump", async () => {
      await createCorruptBackup("backup-corrupt");

      const result = await runVerify(backupDir, "backup-corrupt");

      expect(result.success).toBe(false);
      expect(result.database?.valid).toBe(false);
      expect(result.database?.error).toContain("mismatch");
    });

    it("should detect missing database dump", async () => {
      const backupPath = join(backupDir, "backup-missing-db");
      await mkdir(backupPath, { recursive: true });

      const manifest: BackupManifest = {
        id: "backup-missing-db",
        timestamp: new Date().toISOString(),
        version: "0.1.0",
        database: {
          name: "testdb",
          size: 1024,
          checksum: "some-checksum",
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

      const result = await runVerify(backupDir, "backup-missing-db");

      expect(result.success).toBe(false);
      expect(result.database?.valid).toBe(false);
      expect(result.database?.error).toContain("not found");
    });
  });

  describe("directory verification", () => {
    it("should verify valid directory archives", async () => {
      await createValidBackup("backup-with-dirs");

      const result = await runVerify(backupDir, "backup-with-dirs");

      expect(result.success).toBe(true);
      expect(result.directories?.length).toBe(1);
      expect(result.directories?.[0].valid).toBe(true);
    });

    it("should detect corrupt directory archive", async () => {
      const backupPath = join(backupDir, "backup-corrupt-dir");
      await mkdir(backupPath, { recursive: true });

      // Create database dump with correct checksum
      const dbContent = "-- PostgreSQL dump";
      const dbPath = join(backupPath, "testdb.sql.gz");
      await $`echo ${dbContent} | gzip > ${dbPath}`.quiet();
      const dbChecksum = await calculateChecksum(dbPath);

      // Create archive file
      const archivePath = join(backupPath, "data.tar.gz");
      await writeFile(archivePath, "some archive content");

      const manifest: BackupManifest = {
        id: "backup-corrupt-dir",
        timestamp: new Date().toISOString(),
        version: "0.1.0",
        database: {
          name: "testdb",
          size: 1024,
          checksum: dbChecksum,
        },
        directories: [
          {
            path: "/data",
            size: 100,
            fileCount: 1,
            checksum: "wrong-checksum-xyz", // Wrong checksum
          },
        ],
        encrypted: false,
        status: "complete",
        duration: 60,
      };

      await writeFile(
        join(backupPath, "manifest.json"),
        JSON.stringify(manifest, null, 2)
      );

      const result = await runVerify(backupDir, "backup-corrupt-dir");

      expect(result.success).toBe(false);
      expect(result.database?.valid).toBe(true); // DB is valid
      expect(result.directories?.[0].valid).toBe(false); // Dir is corrupt
    });

    it("should detect missing directory archive", async () => {
      const backupPath = join(backupDir, "backup-missing-dir");
      await mkdir(backupPath, { recursive: true });

      // Create database dump
      const dbContent = "-- PostgreSQL dump";
      const dbPath = join(backupPath, "testdb.sql.gz");
      await $`echo ${dbContent} | gzip > ${dbPath}`.quiet();
      const dbChecksum = await calculateChecksum(dbPath);

      const manifest: BackupManifest = {
        id: "backup-missing-dir",
        timestamp: new Date().toISOString(),
        version: "0.1.0",
        database: {
          name: "testdb",
          size: 1024,
          checksum: dbChecksum,
        },
        directories: [
          {
            path: "/missing/dir",
            size: 100,
            fileCount: 1,
            checksum: "some-checksum",
          },
        ],
        encrypted: false,
        status: "complete",
        duration: 60,
      };

      await writeFile(
        join(backupPath, "manifest.json"),
        JSON.stringify(manifest, null, 2)
      );

      const result = await runVerify(backupDir, "backup-missing-dir");

      expect(result.success).toBe(false);
      expect(result.directories?.[0].valid).toBe(false);
      expect(result.directories?.[0].error).toContain("not found");
    });
  });

  describe("encrypted backup verification", () => {
    it("should verify encrypted backup files", async () => {
      const backupPath = join(backupDir, "backup-encrypted");
      await mkdir(backupPath, { recursive: true });

      // Create encrypted database dump
      const dbContent = "-- Encrypted database dump content";
      const dbPath = join(backupPath, "testdb.sql.gz.gpg");
      await writeFile(dbPath, dbContent);
      const dbChecksum = await calculateChecksum(dbPath);

      const manifest: BackupManifest = {
        id: "backup-encrypted",
        timestamp: new Date().toISOString(),
        version: "0.1.0",
        database: {
          name: "testdb",
          size: 1024,
          checksum: dbChecksum,
        },
        directories: [],
        encrypted: true,
        status: "complete",
        duration: 60,
      };

      await writeFile(
        join(backupPath, "manifest.json"),
        JSON.stringify(manifest, null, 2)
      );

      const result = await runVerify(backupDir, "backup-encrypted");

      expect(result.success).toBe(true);
      expect(result.database?.valid).toBe(true);
    });
  });

  describe("VerifyService.verify", () => {
    it("should verify backup by ID", async () => {
      await createValidBackup("backup-service-test");

      const service = new VerifyService(backupDir);
      const result = await service.verify("backup-service-test");

      expect(result.success).toBe(true);
      expect(result.backupId).toBe("backup-service-test");
    });
  });

  describe("result details", () => {
    it("should include manifest in result", async () => {
      await createValidBackup("backup-with-manifest");

      const result = await runVerify(backupDir, "backup-with-manifest");

      expect(result.manifest).toBeDefined();
      expect(result.manifest?.id).toBe("backup-with-manifest");
    });

    it("should include duration in result", async () => {
      await createValidBackup("backup-with-duration");

      const result = await runVerify(backupDir, "backup-with-duration");

      expect(typeof result.duration).toBe("number");
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });
});
