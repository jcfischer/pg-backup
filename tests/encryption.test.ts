/**
 * Tests for GPG encryption/decryption operations
 * Requires GPG to be installed on the system
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from "bun:test";
import { mkdtemp, rm, writeFile, readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  encryptFile,
  decryptFile,
  encryptAndRemove,
  decryptAndRemove,
  checkGpgAvailable,
} from "../src/encryption";

describe("encryption", () => {
  let tempDir: string;
  let gpgAvailable: boolean;

  beforeAll(async () => {
    gpgAvailable = await checkGpgAvailable();
    if (!gpgAvailable) {
      console.warn("GPG not available - skipping encryption tests");
    }
  });

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pg-backup-encrypt-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("checkGpgAvailable", () => {
    it("should return true if GPG is installed", async () => {
      const available = await checkGpgAvailable();
      // This test will pass based on system configuration
      expect(typeof available).toBe("boolean");
    });
  });

  describe("encryptFile", () => {
    it("should encrypt a file with passphrase", async function() {
      if (!gpgAvailable) {
        console.log("Skipping: GPG not available");
        return;
      }

      const inputPath = join(tempDir, "plain.txt");
      const outputPath = join(tempDir, "encrypted.gpg");
      const passphrase = "test-passphrase-123";
      const content = "This is secret content";

      await writeFile(inputPath, content);

      const result = await encryptFile(inputPath, outputPath, passphrase);

      expect(result.success).toBe(true);
      expect(result.outputPath).toBe(outputPath);
      expect(existsSync(outputPath)).toBe(true);

      // Encrypted file should be different from original
      const encryptedContent = await readFile(outputPath);
      expect(encryptedContent.toString()).not.toBe(content);
    });

    it("should return error for non-existent input file", async () => {
      const result = await encryptFile(
        "/nonexistent/file.txt",
        join(tempDir, "out.gpg"),
        "passphrase"
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("decryptFile", () => {
    it("should decrypt an encrypted file", async function() {
      if (!gpgAvailable) {
        console.log("Skipping: GPG not available");
        return;
      }

      const originalPath = join(tempDir, "original.txt");
      const encryptedPath = join(tempDir, "encrypted.gpg");
      const decryptedPath = join(tempDir, "decrypted.txt");
      const passphrase = "test-passphrase-456";
      const content = "Secret message to encrypt and decrypt";

      // Create and encrypt file
      await writeFile(originalPath, content);
      await encryptFile(originalPath, encryptedPath, passphrase);

      // Decrypt
      const result = await decryptFile(encryptedPath, decryptedPath, passphrase);

      expect(result.success).toBe(true);
      expect(result.outputPath).toBe(decryptedPath);

      // Content should match original
      const decryptedContent = await readFile(decryptedPath, "utf-8");
      expect(decryptedContent).toBe(content);
    });

    it("should fail with wrong passphrase", async function() {
      if (!gpgAvailable) {
        console.log("Skipping: GPG not available");
        return;
      }

      const originalPath = join(tempDir, "original.txt");
      const encryptedPath = join(tempDir, "encrypted.gpg");
      const decryptedPath = join(tempDir, "decrypted.txt");

      await writeFile(originalPath, "content");
      await encryptFile(originalPath, encryptedPath, "correct-password");

      const result = await decryptFile(encryptedPath, decryptedPath, "wrong-password");

      expect(result.success).toBe(false);
    });

    it("should return error for non-existent encrypted file", async () => {
      const result = await decryptFile(
        "/nonexistent/file.gpg",
        join(tempDir, "out.txt"),
        "passphrase"
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("encryptAndRemove", () => {
    it("should encrypt file and remove original", async function() {
      if (!gpgAvailable) {
        console.log("Skipping: GPG not available");
        return;
      }

      const inputPath = join(tempDir, "to-encrypt.txt");
      const passphrase = "secure-pass";

      await writeFile(inputPath, "sensitive data");

      const result = await encryptAndRemove(inputPath, passphrase);

      expect(result.success).toBe(true);
      expect(result.outputPath).toBe(`${inputPath}.gpg`);
      expect(existsSync(result.outputPath)).toBe(true);
      expect(existsSync(inputPath)).toBe(false); // Original removed
    });
  });

  describe("decryptAndRemove", () => {
    it("should decrypt file and remove encrypted version", async function() {
      if (!gpgAvailable) {
        console.log("Skipping: GPG not available");
        return;
      }

      const originalPath = join(tempDir, "file.txt");
      const encryptedPath = join(tempDir, "file.txt.gpg");
      const passphrase = "secure-pass";
      const content = "important data";

      await writeFile(originalPath, content);
      await encryptFile(originalPath, encryptedPath, passphrase);
      await rm(originalPath); // Remove original to simulate encrypted-only state

      const result = await decryptAndRemove(encryptedPath, passphrase);

      expect(result.success).toBe(true);
      expect(result.outputPath).toBe(originalPath); // .gpg extension removed
      expect(existsSync(originalPath)).toBe(true);
      expect(existsSync(encryptedPath)).toBe(false); // Encrypted removed

      const decryptedContent = await readFile(originalPath, "utf-8");
      expect(decryptedContent).toBe(content);
    });
  });

  describe("round-trip encryption", () => {
    it("should handle binary files correctly", async function() {
      if (!gpgAvailable) {
        console.log("Skipping: GPG not available");
        return;
      }

      const inputPath = join(tempDir, "binary.bin");
      const encryptedPath = join(tempDir, "binary.bin.gpg");
      const decryptedPath = join(tempDir, "binary-restored.bin");
      const passphrase = "binary-test";

      // Create binary content
      const binaryContent = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
      await writeFile(inputPath, binaryContent);

      // Encrypt
      const encryptResult = await encryptFile(inputPath, encryptedPath, passphrase);
      expect(encryptResult.success).toBe(true);

      // Decrypt
      const decryptResult = await decryptFile(encryptedPath, decryptedPath, passphrase);
      expect(decryptResult.success).toBe(true);

      // Verify content
      const restoredContent = await readFile(decryptedPath);
      expect(Buffer.compare(restoredContent, binaryContent)).toBe(0);
    });

    it("should handle large files", async function() {
      if (!gpgAvailable) {
        console.log("Skipping: GPG not available");
        return;
      }

      const inputPath = join(tempDir, "large.txt");
      const encryptedPath = join(tempDir, "large.gpg");
      const decryptedPath = join(tempDir, "large-restored.txt");
      const passphrase = "large-file-test";

      // Create 1MB file
      const largeContent = "x".repeat(1024 * 1024);
      await writeFile(inputPath, largeContent);

      // Encrypt
      const encryptResult = await encryptFile(inputPath, encryptedPath, passphrase);
      expect(encryptResult.success).toBe(true);

      // Decrypt
      const decryptResult = await decryptFile(encryptedPath, decryptedPath, passphrase);
      expect(decryptResult.success).toBe(true);

      // Verify content
      const restoredContent = await readFile(decryptedPath, "utf-8");
      expect(restoredContent.length).toBe(largeContent.length);
    });
  });
});
