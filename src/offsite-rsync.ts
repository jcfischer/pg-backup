/**
 * Rsync-based offsite backup sync over SSH
 */

import { $ } from "bun";
import { existsSync } from "fs";
import type { RsyncOffsiteConfig } from "./types";

export interface RsyncSyncResult {
  success: boolean;
  filesTransferred: number;
  bytesTransferred: number;
  error?: string;
}

export interface RsyncListResult {
  success: boolean;
  files: Array<{
    name: string;
    size: number;
    date: string;
  }>;
  error?: string;
}

function buildRsyncTarget(config: RsyncOffsiteConfig): string {
  return `${config.user}@${config.host}:${config.path}`;
}

function buildSshOptions(config: RsyncOffsiteConfig): string[] {
  const options: string[] = [];
  const timeout = config.timeout || 10; // Default 10 second connection timeout

  if (config.sshKeyPath) {
    options.push("-e", `ssh -i ${config.sshKeyPath} -o StrictHostKeyChecking=accept-new -o ConnectTimeout=${timeout}`);
  } else {
    options.push("-e", `ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=${timeout}`);
  }

  return options;
}

/**
 * Sync a local file to remote server via rsync
 */
export async function syncFileToRemote(
  config: RsyncOffsiteConfig,
  localPath: string
): Promise<RsyncSyncResult> {
  if (!existsSync(localPath)) {
    return {
      success: false,
      filesTransferred: 0,
      bytesTransferred: 0,
      error: `Local file not found: ${localPath}`,
    };
  }

  const target = buildRsyncTarget(config);
  const sshOptions = buildSshOptions(config);

  try {
    // Ensure remote directory exists
    const timeout = config.timeout || 10;
    const mkdirCmd = config.sshKeyPath
      ? `ssh -i ${config.sshKeyPath} -o StrictHostKeyChecking=accept-new -o ConnectTimeout=${timeout} ${config.user}@${config.host} "mkdir -p ${config.path}"`
      : `ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=${timeout} ${config.user}@${config.host} "mkdir -p ${config.path}"`;

    await $`bash -c ${mkdirCmd}`.quiet();

    // Run rsync with stats
    const result = await $`rsync -avz --stats ${sshOptions} ${localPath} ${target}/`.quiet();

    if (result.exitCode !== 0) {
      return {
        success: false,
        filesTransferred: 0,
        bytesTransferred: 0,
        error: `rsync failed with exit code ${result.exitCode}`,
      };
    }

    // Parse rsync stats output
    const output = result.text();
    const filesMatch = output.match(/Number of regular files transferred: (\d+)/);
    const bytesMatch = output.match(/Total transferred file size: ([\d,]+)/);

    return {
      success: true,
      filesTransferred: filesMatch ? parseInt(filesMatch[1], 10) : 1,
      bytesTransferred: bytesMatch ? parseInt(bytesMatch[1].replace(/,/g, ""), 10) : 0,
    };
  } catch (error) {
    return {
      success: false,
      filesTransferred: 0,
      bytesTransferred: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Sync multiple local files to remote server
 */
export async function syncFilesToRemote(
  config: RsyncOffsiteConfig,
  localPaths: string[]
): Promise<RsyncSyncResult> {
  let totalFiles = 0;
  let totalBytes = 0;
  const errors: string[] = [];

  for (const localPath of localPaths) {
    const result = await syncFileToRemote(config, localPath);
    if (result.success) {
      totalFiles += result.filesTransferred;
      totalBytes += result.bytesTransferred;
    } else {
      errors.push(`${localPath}: ${result.error}`);
    }
  }

  return {
    success: errors.length === 0,
    filesTransferred: totalFiles,
    bytesTransferred: totalBytes,
    error: errors.length > 0 ? errors.join("; ") : undefined,
  };
}

/**
 * Sync a directory to remote server
 */
export async function syncDirectoryToRemote(
  config: RsyncOffsiteConfig,
  localDir: string
): Promise<RsyncSyncResult> {
  if (!existsSync(localDir)) {
    return {
      success: false,
      filesTransferred: 0,
      bytesTransferred: 0,
      error: `Local directory not found: ${localDir}`,
    };
  }

  const target = buildRsyncTarget(config);
  const sshOptions = buildSshOptions(config);

  try {
    // Ensure trailing slash on local dir to sync contents
    const sourceDir = localDir.endsWith("/") ? localDir : `${localDir}/`;

    const result = await $`rsync -avz --stats ${sshOptions} ${sourceDir} ${target}/`.quiet();

    if (result.exitCode !== 0) {
      return {
        success: false,
        filesTransferred: 0,
        bytesTransferred: 0,
        error: `rsync failed with exit code ${result.exitCode}`,
      };
    }

    const output = result.text();
    const filesMatch = output.match(/Number of regular files transferred: (\d+)/);
    const bytesMatch = output.match(/Total transferred file size: ([\d,]+)/);

    return {
      success: true,
      filesTransferred: filesMatch ? parseInt(filesMatch[1], 10) : 0,
      bytesTransferred: bytesMatch ? parseInt(bytesMatch[1].replace(/,/g, ""), 10) : 0,
    };
  } catch (error) {
    return {
      success: false,
      filesTransferred: 0,
      bytesTransferred: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Download a file from remote server
 */
export async function downloadFromRemote(
  config: RsyncOffsiteConfig,
  remoteFilename: string,
  localPath: string
): Promise<{ success: boolean; error?: string }> {
  const target = buildRsyncTarget(config);
  const sshOptions = buildSshOptions(config);

  try {
    const result = await $`rsync -avz ${sshOptions} ${target}/${remoteFilename} ${localPath}`.quiet();

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: `rsync download failed with exit code ${result.exitCode}`,
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
 * List files on remote server
 */
export async function listRemoteFiles(
  config: RsyncOffsiteConfig
): Promise<RsyncListResult> {
  const sshCmd = config.sshKeyPath
    ? `ssh -i ${config.sshKeyPath} -o StrictHostKeyChecking=accept-new`
    : `ssh -o StrictHostKeyChecking=accept-new`;

  try {
    const result = await $`${sshCmd} ${config.user}@${config.host} "ls -lh ${config.path}/"`.quiet();

    if (result.exitCode !== 0) {
      return {
        success: false,
        files: [],
        error: `Failed to list remote files`,
      };
    }

    const output = result.text();
    const lines = output.trim().split("\n").slice(1); // Skip total line

    const files = lines
      .filter((line) => line.trim())
      .map((line) => {
        const parts = line.split(/\s+/);
        // Format: -rw-r--r-- 1 user group size month day time filename
        if (parts.length >= 9) {
          return {
            name: parts.slice(8).join(" "),
            size: parseInt(parts[4], 10) || 0,
            date: `${parts[5]} ${parts[6]} ${parts[7]}`,
          };
        }
        return null;
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);

    return { success: true, files };
  } catch (error) {
    return {
      success: false,
      files: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Delete a file from remote server
 */
export async function deleteFromRemote(
  config: RsyncOffsiteConfig,
  remoteFilename: string
): Promise<{ success: boolean; error?: string }> {
  const sshCmd = config.sshKeyPath
    ? `ssh -i ${config.sshKeyPath} -o StrictHostKeyChecking=accept-new`
    : `ssh -o StrictHostKeyChecking=accept-new`;

  try {
    const result = await $`${sshCmd} ${config.user}@${config.host} "rm -f ${config.path}/${remoteFilename}"`.quiet();

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: `Failed to delete remote file`,
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
 * Check if rsync connection is valid
 */
export async function checkRsyncConnection(
  config: RsyncOffsiteConfig
): Promise<{ success: boolean; error?: string }> {
  const sshCmd = config.sshKeyPath
    ? `ssh -i ${config.sshKeyPath} -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10`
    : `ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10`;

  try {
    const result = await $`${sshCmd} ${config.user}@${config.host} "echo ok"`.quiet();

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: "SSH connection failed",
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
 * Check if rsync is available
 */
export async function checkRsyncAvailable(): Promise<boolean> {
  try {
    const result = await $`which rsync`.quiet();
    return result.exitCode === 0;
  } catch {
    return false;
  }
}
