/**
 * Directory backup and restore using tar
 */

import { $ } from "bun";
import { existsSync } from "fs";
import { stat, readdir } from "fs/promises";
import { dirname, basename } from "path";

export interface ArchiveResult {
  success: boolean;
  path: string;
  size: number;
  fileCount: number;
  error?: string;
}

export interface ExtractResult {
  success: boolean;
  error?: string;
}

/**
 * Count files in a directory recursively
 */
async function countFiles(dirPath: string): Promise<number> {
  if (!existsSync(dirPath)) {
    return 0;
  }

  try {
    const result = await $`find ${dirPath} -type f | wc -l`.quiet().text();
    return parseInt(result.trim(), 10);
  } catch {
    return 0;
  }
}

/**
 * Archive a directory to a gzipped tarball
 */
export async function archiveDirectory(
  sourcePath: string,
  outputPath: string
): Promise<ArchiveResult> {
  if (!existsSync(sourcePath)) {
    return {
      success: false,
      path: outputPath,
      size: 0,
      fileCount: 0,
      error: `Source directory not found: ${sourcePath}`,
    };
  }

  try {
    // Get file count before archiving
    const fileCount = await countFiles(sourcePath);

    // Create tar.gz archive
    // Use -C to change to parent directory, then archive the basename
    const parentDir = dirname(sourcePath);
    const dirName = basename(sourcePath);

    const result = await $`tar -czf ${outputPath} -C ${parentDir} ${dirName}`.quiet();

    if (result.exitCode !== 0) {
      return {
        success: false,
        path: outputPath,
        size: 0,
        fileCount: 0,
        error: `tar failed with exit code ${result.exitCode}`,
      };
    }

    // Get archive size
    const stats = await stat(outputPath);

    return {
      success: true,
      path: outputPath,
      size: stats.size,
      fileCount,
    };
  } catch (error) {
    return {
      success: false,
      path: outputPath,
      size: 0,
      fileCount: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Archive multiple directories into a single tarball
 */
export async function archiveDirectories(
  sourcePaths: string[],
  outputPath: string
): Promise<ArchiveResult> {
  // Filter to only existing directories
  const existingPaths = sourcePaths.filter((p) => existsSync(p));

  if (existingPaths.length === 0) {
    return {
      success: false,
      path: outputPath,
      size: 0,
      fileCount: 0,
      error: "No valid source directories found",
    };
  }

  try {
    // Count total files
    let totalFiles = 0;
    for (const p of existingPaths) {
      totalFiles += await countFiles(p);
    }

    // Create tar with absolute paths
    const pathArgs = existingPaths.join(" ");
    const result = await $`tar -czf ${outputPath} ${existingPaths}`.quiet();

    if (result.exitCode !== 0) {
      return {
        success: false,
        path: outputPath,
        size: 0,
        fileCount: 0,
        error: `tar failed with exit code ${result.exitCode}`,
      };
    }

    const stats = await stat(outputPath);

    return {
      success: true,
      path: outputPath,
      size: stats.size,
      fileCount: totalFiles,
    };
  } catch (error) {
    return {
      success: false,
      path: outputPath,
      size: 0,
      fileCount: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Extract a tarball to a target directory
 */
export async function extractArchive(
  archivePath: string,
  targetDir: string
): Promise<ExtractResult> {
  if (!existsSync(archivePath)) {
    return {
      success: false,
      error: `Archive not found: ${archivePath}`,
    };
  }

  try {
    // Create target directory if needed
    await $`mkdir -p ${targetDir}`.quiet();

    // Extract
    const result = await $`tar -xzf ${archivePath} -C ${targetDir}`.quiet();

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: `tar extract failed with exit code ${result.exitCode}`,
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Verify a tarball is valid
 */
export async function verifyArchive(archivePath: string): Promise<boolean> {
  if (!existsSync(archivePath)) {
    return false;
  }

  try {
    // Test archive integrity
    const result = await $`tar -tzf ${archivePath}`.quiet();
    return result.exitCode === 0;
  } catch {
    return false;
  }
}
