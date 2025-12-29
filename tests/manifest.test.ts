/**
 * Tests for backup manifest operations
 * TDD: Write tests FIRST, then implement
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { BackupManifest } from "../src/types";

// Import functions we'll implement
import {
  createManifest,
  saveManifest,
  loadManifest,
  listManifests,
  getLatestManifest,
  calculateChecksum,
} from "../src/manifest";

describe("manifest", () => {
  let tempDir: string;
  let backupDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pg-backup-manifest-"));
    backupDir = join(tempDir, "backups");
    await mkdir(backupDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("createManifest", () => {
    it("should create a manifest with unique ID based on timestamp", () => {
      const manifest = createManifest({
        databaseName: "testdb",
        databaseSize: 1024000,
        databaseChecksum: "abc123",
        tableCount: 42,
        directories: [
          {
            path: "/data/uploads",
            size: 2048000,
            fileCount: 100,
            checksum: "def456",
          },
        ],
        encrypted: true,
        duration: 120,
      });

      expect(manifest.id).toMatch(/^backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
      expect(manifest.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(manifest.version).toBeDefined();
      expect(manifest.database.name).toBe("testdb");
      expect(manifest.database.size).toBe(1024000);
      expect(manifest.database.checksum).toBe("abc123");
      expect(manifest.database.tableCount).toBe(42);
      expect(manifest.directories).toHaveLength(1);
      expect(manifest.encrypted).toBe(true);
      expect(manifest.status).toBe("complete");
      expect(manifest.duration).toBe(120);
    });

    it("should create manifest with failed status", () => {
      const manifest = createManifest({
        databaseName: "testdb",
        databaseSize: 0,
        databaseChecksum: "",
        directories: [],
        encrypted: false,
        duration: 10,
        status: "failed",
      });

      expect(manifest.status).toBe("failed");
    });

    it("should include offsite sync info when provided", () => {
      const manifest = createManifest({
        databaseName: "db",
        databaseSize: 1000,
        databaseChecksum: "xyz",
        directories: [],
        encrypted: false,
        duration: 60,
        offsite: {
          synced: true,
          syncedAt: "2025-12-28T12:05:00Z",
          type: "s3",
        },
      });

      expect(manifest.offsite?.synced).toBe(true);
      expect(manifest.offsite?.type).toBe("s3");
    });
  });

  describe("saveManifest", () => {
    it("should save manifest to JSON file", async () => {
      const manifest: BackupManifest = {
        id: "backup-2025-12-28T12-00-00",
        timestamp: "2025-12-28T12:00:00Z",
        version: "0.1.0",
        database: {
          name: "testdb",
          size: 1024,
          checksum: "abc",
        },
        directories: [],
        encrypted: false,
        status: "complete",
        duration: 60,
      };

      const manifestPath = await saveManifest(backupDir, manifest);

      expect(manifestPath).toBe(join(backupDir, "backup-2025-12-28T12-00-00", "manifest.json"));
      expect(existsSync(manifestPath)).toBe(true);

      const content = await readFile(manifestPath, "utf-8");
      const saved = JSON.parse(content);
      expect(saved.id).toBe(manifest.id);
      expect(saved.database.name).toBe("testdb");
    });

    it("should create backup subdirectory", async () => {
      const manifest: BackupManifest = {
        id: "backup-2025-12-28T14-30-00",
        timestamp: "2025-12-28T14:30:00Z",
        version: "0.1.0",
        database: { name: "db", size: 100, checksum: "x" },
        directories: [],
        encrypted: false,
        status: "complete",
        duration: 30,
      };

      await saveManifest(backupDir, manifest);

      const backupSubdir = join(backupDir, "backup-2025-12-28T14-30-00");
      expect(existsSync(backupSubdir)).toBe(true);
    });
  });

  describe("loadManifest", () => {
    it("should load manifest from file", async () => {
      const manifest: BackupManifest = {
        id: "backup-test",
        timestamp: "2025-12-28T12:00:00Z",
        version: "0.1.0",
        database: { name: "mydb", size: 5000, checksum: "hash" },
        directories: [{ path: "/data", size: 1000, fileCount: 10, checksum: "h2" }],
        encrypted: true,
        status: "complete",
        duration: 90,
      };

      // Save first
      const manifestPath = await saveManifest(backupDir, manifest);

      // Load and verify
      const loaded = await loadManifest(manifestPath);

      expect(loaded.id).toBe("backup-test");
      expect(loaded.database.name).toBe("mydb");
      expect(loaded.directories).toHaveLength(1);
      expect(loaded.encrypted).toBe(true);
    });

    it("should throw error for non-existent file", async () => {
      await expect(loadManifest("/nonexistent/manifest.json")).rejects.toThrow();
    });

    it("should throw error for invalid JSON", async () => {
      const invalidPath = join(tempDir, "invalid.json");
      await writeFile(invalidPath, "not valid json {{{");

      await expect(loadManifest(invalidPath)).rejects.toThrow();
    });
  });

  describe("listManifests", () => {
    it("should list all manifests in backup directory", async () => {
      // Create multiple backups
      const manifests: BackupManifest[] = [
        {
          id: "backup-2025-12-26T10-00-00",
          timestamp: "2025-12-26T10:00:00Z",
          version: "0.1.0",
          database: { name: "db", size: 100, checksum: "a" },
          directories: [],
          encrypted: false,
          status: "complete",
          duration: 60,
        },
        {
          id: "backup-2025-12-27T10-00-00",
          timestamp: "2025-12-27T10:00:00Z",
          version: "0.1.0",
          database: { name: "db", size: 200, checksum: "b" },
          directories: [],
          encrypted: false,
          status: "complete",
          duration: 70,
        },
        {
          id: "backup-2025-12-28T10-00-00",
          timestamp: "2025-12-28T10:00:00Z",
          version: "0.1.0",
          database: { name: "db", size: 300, checksum: "c" },
          directories: [],
          encrypted: false,
          status: "complete",
          duration: 80,
        },
      ];

      for (const m of manifests) {
        await saveManifest(backupDir, m);
      }

      const listed = await listManifests(backupDir);

      expect(listed).toHaveLength(3);
      // Should be sorted by timestamp descending (newest first)
      expect(listed[0].id).toBe("backup-2025-12-28T10-00-00");
      expect(listed[1].id).toBe("backup-2025-12-27T10-00-00");
      expect(listed[2].id).toBe("backup-2025-12-26T10-00-00");
    });

    it("should return empty array for empty backup directory", async () => {
      const listed = await listManifests(backupDir);

      expect(listed).toEqual([]);
    });

    it("should skip directories without manifest.json", async () => {
      // Create a backup with manifest
      const manifest: BackupManifest = {
        id: "backup-valid",
        timestamp: "2025-12-28T12:00:00Z",
        version: "0.1.0",
        database: { name: "db", size: 100, checksum: "x" },
        directories: [],
        encrypted: false,
        status: "complete",
        duration: 60,
      };
      await saveManifest(backupDir, manifest);

      // Create a directory without manifest
      await mkdir(join(backupDir, "orphan-backup"));
      await writeFile(join(backupDir, "orphan-backup", "data.sql"), "data");

      const listed = await listManifests(backupDir);

      expect(listed).toHaveLength(1);
      expect(listed[0].id).toBe("backup-valid");
    });
  });

  describe("getLatestManifest", () => {
    it("should return the most recent manifest", async () => {
      const manifests: BackupManifest[] = [
        {
          id: "backup-2025-12-26T10-00-00",
          timestamp: "2025-12-26T10:00:00Z",
          version: "0.1.0",
          database: { name: "db", size: 100, checksum: "old" },
          directories: [],
          encrypted: false,
          status: "complete",
          duration: 60,
        },
        {
          id: "backup-2025-12-28T10-00-00",
          timestamp: "2025-12-28T10:00:00Z",
          version: "0.1.0",
          database: { name: "db", size: 300, checksum: "newest" },
          directories: [],
          encrypted: false,
          status: "complete",
          duration: 80,
        },
      ];

      for (const m of manifests) {
        await saveManifest(backupDir, m);
      }

      const latest = await getLatestManifest(backupDir);

      expect(latest).not.toBeNull();
      expect(latest?.database.checksum).toBe("newest");
    });

    it("should return null for empty backup directory", async () => {
      const latest = await getLatestManifest(backupDir);

      expect(latest).toBeNull();
    });
  });

  describe("calculateChecksum", () => {
    it("should calculate SHA-256 checksum of file", async () => {
      const filePath = join(tempDir, "test.txt");
      await writeFile(filePath, "Hello, World!");

      const checksum = await calculateChecksum(filePath);

      // SHA-256 of "Hello, World!" is known
      expect(checksum).toBe("dffd6021bb2bd5b0af676290809ec3a53191dd81c7f70a4b28688a362182986f");
    });

    it("should return different checksums for different content", async () => {
      const file1 = join(tempDir, "file1.txt");
      const file2 = join(tempDir, "file2.txt");
      await writeFile(file1, "content1");
      await writeFile(file2, "content2");

      const checksum1 = await calculateChecksum(file1);
      const checksum2 = await calculateChecksum(file2);

      expect(checksum1).not.toBe(checksum2);
    });

    it("should handle binary files", async () => {
      const binPath = join(tempDir, "binary.bin");
      await writeFile(binPath, Buffer.from([0x00, 0x01, 0x02, 0xff]));

      const checksum = await calculateChecksum(binPath);

      expect(checksum).toHaveLength(64); // SHA-256 hex is 64 chars
    });

    it("should throw error for non-existent file", async () => {
      await expect(calculateChecksum("/nonexistent/file")).rejects.toThrow();
    });
  });
});
