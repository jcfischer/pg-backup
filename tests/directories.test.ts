/**
 * Tests for directory backup/restore operations
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir, readdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  archiveDirectory,
  archiveDirectories,
  extractArchive,
  verifyArchive,
} from "../src/directories";

describe("directories", () => {
  let tempDir: string;
  let sourceDir: string;
  let outputDir: string;

  beforeEach(async () => {
    // Create temp directories for testing
    tempDir = await mkdtemp(join(tmpdir(), "pg-backup-test-"));
    sourceDir = join(tempDir, "source");
    outputDir = join(tempDir, "output");
    await mkdir(sourceDir, { recursive: true });
    await mkdir(outputDir, { recursive: true });
  });

  afterEach(async () => {
    // Cleanup
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("archiveDirectory", () => {
    it("should archive a directory to tar.gz", async () => {
      // Create test files
      await writeFile(join(sourceDir, "file1.txt"), "Hello World");
      await writeFile(join(sourceDir, "file2.txt"), "Test content");

      const archivePath = join(outputDir, "archive.tar.gz");
      const result = await archiveDirectory(sourceDir, archivePath);

      expect(result.success).toBe(true);
      expect(result.path).toBe(archivePath);
      expect(result.size).toBeGreaterThan(0);
      expect(result.fileCount).toBe(2);
    });

    it("should include nested directories", async () => {
      // Create nested structure
      const subDir = join(sourceDir, "subdir");
      await mkdir(subDir, { recursive: true });
      await writeFile(join(sourceDir, "root.txt"), "root");
      await writeFile(join(subDir, "nested.txt"), "nested");

      const archivePath = join(outputDir, "nested.tar.gz");
      const result = await archiveDirectory(sourceDir, archivePath);

      expect(result.success).toBe(true);
      expect(result.fileCount).toBe(2);
    });

    it("should return error for non-existent directory", async () => {
      const result = await archiveDirectory(
        "/nonexistent/path",
        join(outputDir, "out.tar.gz")
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should handle empty directories", async () => {
      const archivePath = join(outputDir, "empty.tar.gz");
      const result = await archiveDirectory(sourceDir, archivePath);

      expect(result.success).toBe(true);
      expect(result.fileCount).toBe(0);
    });
  });

  describe("archiveDirectories", () => {
    it("should archive multiple directories into one tarball", async () => {
      // Create two source directories
      const dir1 = join(tempDir, "dir1");
      const dir2 = join(tempDir, "dir2");
      await mkdir(dir1, { recursive: true });
      await mkdir(dir2, { recursive: true });
      await writeFile(join(dir1, "a.txt"), "content a");
      await writeFile(join(dir2, "b.txt"), "content b");

      const archivePath = join(outputDir, "multi.tar.gz");
      const result = await archiveDirectories([dir1, dir2], archivePath);

      expect(result.success).toBe(true);
      expect(result.fileCount).toBe(2);
      expect(result.size).toBeGreaterThan(0);
    });

    it("should skip non-existent directories", async () => {
      await writeFile(join(sourceDir, "file.txt"), "content");

      const archivePath = join(outputDir, "partial.tar.gz");
      const result = await archiveDirectories(
        [sourceDir, "/nonexistent"],
        archivePath
      );

      expect(result.success).toBe(true);
      expect(result.fileCount).toBe(1);
    });

    it("should return error when all directories are invalid", async () => {
      const result = await archiveDirectories(
        ["/nonexistent1", "/nonexistent2"],
        join(outputDir, "out.tar.gz")
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("No valid source directories");
    });
  });

  describe("extractArchive", () => {
    it("should extract tarball to target directory", async () => {
      // Create and archive files
      await writeFile(join(sourceDir, "test.txt"), "test content");
      const archivePath = join(outputDir, "test.tar.gz");
      await archiveDirectory(sourceDir, archivePath);

      // Extract to new location
      const extractDir = join(tempDir, "extracted");
      const result = await extractArchive(archivePath, extractDir);

      expect(result.success).toBe(true);

      // Verify extracted content
      const files = await readdir(extractDir);
      expect(files).toContain("source"); // Directory name is preserved
    });

    it("should create target directory if it doesn't exist", async () => {
      await writeFile(join(sourceDir, "file.txt"), "content");
      const archivePath = join(outputDir, "test.tar.gz");
      await archiveDirectory(sourceDir, archivePath);

      const newDir = join(tempDir, "brand-new-dir");
      const result = await extractArchive(archivePath, newDir);

      expect(result.success).toBe(true);
    });

    it("should return error for non-existent archive", async () => {
      const result = await extractArchive(
        "/nonexistent/archive.tar.gz",
        outputDir
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("verifyArchive", () => {
    it("should return true for valid archive", async () => {
      await writeFile(join(sourceDir, "file.txt"), "content");
      const archivePath = join(outputDir, "valid.tar.gz");
      await archiveDirectory(sourceDir, archivePath);

      const isValid = await verifyArchive(archivePath);

      expect(isValid).toBe(true);
    });

    it("should return false for non-existent file", async () => {
      const isValid = await verifyArchive("/nonexistent/file.tar.gz");

      expect(isValid).toBe(false);
    });

    it("should return false for corrupted archive", async () => {
      // Create a file that's not a valid tarball
      const corruptPath = join(outputDir, "corrupt.tar.gz");
      await writeFile(corruptPath, "this is not a tar file");

      const isValid = await verifyArchive(corruptPath);

      expect(isValid).toBe(false);
    });
  });
});
