/**
 * File encryption and decryption using GPG (symmetric)
 */

import { $ } from "bun";
import { existsSync } from "fs";
import { unlink } from "fs/promises";

export interface EncryptResult {
  success: boolean;
  outputPath: string;
  error?: string;
}

export interface DecryptResult {
  success: boolean;
  outputPath: string;
  error?: string;
}

/**
 * Encrypt a file using GPG symmetric encryption (AES-256)
 */
export async function encryptFile(
  inputPath: string,
  outputPath: string,
  passphrase: string
): Promise<EncryptResult> {
  if (!existsSync(inputPath)) {
    return {
      success: false,
      outputPath,
      error: `Input file not found: ${inputPath}`,
    };
  }

  try {
    // Use GPG with symmetric encryption
    // --batch: non-interactive mode
    // --yes: overwrite output file
    // --cipher-algo AES256: use AES-256
    // --passphrase-fd 0: read passphrase from stdin
    const result = await $`echo ${passphrase} | gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase-fd 0 --output ${outputPath} ${inputPath}`.quiet();

    if (result.exitCode !== 0) {
      return {
        success: false,
        outputPath,
        error: `GPG encryption failed with exit code ${result.exitCode}`,
      };
    }

    return {
      success: true,
      outputPath,
    };
  } catch (error) {
    return {
      success: false,
      outputPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Decrypt a GPG-encrypted file
 */
export async function decryptFile(
  inputPath: string,
  outputPath: string,
  passphrase: string
): Promise<DecryptResult> {
  if (!existsSync(inputPath)) {
    return {
      success: false,
      outputPath,
      error: `Encrypted file not found: ${inputPath}`,
    };
  }

  try {
    const result = await $`echo ${passphrase} | gpg --batch --yes --decrypt --passphrase-fd 0 --output ${outputPath} ${inputPath}`.quiet();

    if (result.exitCode !== 0) {
      return {
        success: false,
        outputPath,
        error: `GPG decryption failed with exit code ${result.exitCode}`,
      };
    }

    return {
      success: true,
      outputPath,
    };
  } catch (error) {
    return {
      success: false,
      outputPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Encrypt and remove original file
 */
export async function encryptAndRemove(
  inputPath: string,
  passphrase: string
): Promise<EncryptResult> {
  const outputPath = `${inputPath}.gpg`;
  const result = await encryptFile(inputPath, outputPath, passphrase);

  if (result.success) {
    try {
      await unlink(inputPath);
    } catch {
      // Ignore removal errors
    }
  }

  return result;
}

/**
 * Decrypt and remove encrypted file
 */
export async function decryptAndRemove(
  inputPath: string,
  passphrase: string
): Promise<DecryptResult> {
  // Remove .gpg extension for output
  const outputPath = inputPath.replace(/\.gpg$/, "");
  const result = await decryptFile(inputPath, outputPath, passphrase);

  if (result.success) {
    try {
      await unlink(inputPath);
    } catch {
      // Ignore removal errors
    }
  }

  return result;
}

/**
 * Check if GPG is available
 */
export async function checkGpgAvailable(): Promise<boolean> {
  try {
    const result = await $`which gpg`.quiet();
    return result.exitCode === 0;
  } catch {
    return false;
  }
}
