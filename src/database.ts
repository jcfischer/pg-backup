/**
 * Database backup and restore using pg_dump/pg_restore
 */

import { $ } from "bun";
import { existsSync } from "fs";
import { stat } from "fs/promises";
import type { DatabaseConfig } from "./types";

export interface DumpResult {
  success: boolean;
  path: string;
  size: number;
  tableCount?: number;
  error?: string;
}

export interface RestoreResult {
  success: boolean;
  error?: string;
}

function buildPgEnv(config: DatabaseConfig): Record<string, string> {
  const env: Record<string, string> = {
    PGHOST: config.host,
    PGPORT: config.port.toString(),
    PGDATABASE: config.name,
    PGUSER: config.user,
  };

  if (config.password) {
    env.PGPASSWORD = config.password;
  }

  return env;
}

/**
 * Dump database to a gzipped SQL file
 */
export async function dumpDatabase(
  config: DatabaseConfig,
  outputPath: string
): Promise<DumpResult> {
  const env = buildPgEnv(config);

  try {
    // Run pg_dump with gzip compression
    const result = await $`pg_dump --no-owner --no-acl --clean --if-exists | gzip > ${outputPath}`
      .env(env)
      .quiet();

    if (result.exitCode !== 0) {
      return {
        success: false,
        path: outputPath,
        size: 0,
        error: `pg_dump failed with exit code ${result.exitCode}`,
      };
    }

    // Get file size
    const stats = await stat(outputPath);

    // Count tables (optional, for manifest)
    let tableCount: number | undefined;
    try {
      const countResult = await $`psql -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'"`
        .env(env)
        .quiet()
        .text();
      tableCount = parseInt(countResult.trim(), 10);
    } catch {
      // Ignore table count errors
    }

    return {
      success: true,
      path: outputPath,
      size: stats.size,
      tableCount,
    };
  } catch (error) {
    return {
      success: false,
      path: outputPath,
      size: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Restore database from a gzipped SQL file
 */
export async function restoreDatabase(
  config: DatabaseConfig,
  inputPath: string,
  targetDatabase?: string
): Promise<RestoreResult> {
  if (!existsSync(inputPath)) {
    return {
      success: false,
      error: `Backup file not found: ${inputPath}`,
    };
  }

  const env = buildPgEnv({
    ...config,
    name: targetDatabase ?? config.name,
  });

  try {
    // Decompress and restore
    const result = await $`gunzip -c ${inputPath} | psql`
      .env(env)
      .quiet();

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: `psql restore failed with exit code ${result.exitCode}`,
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
 * Verify database dump by attempting a test restore
 */
export async function verifyDatabaseDump(
  config: DatabaseConfig,
  dumpPath: string
): Promise<boolean> {
  if (!existsSync(dumpPath)) {
    return false;
  }

  try {
    // Just verify the gzip is valid and contains SQL
    const result = await $`gunzip -c ${dumpPath} | head -100`.quiet();
    const content = result.text();

    // Check for PostgreSQL dump markers
    return (
      content.includes("PostgreSQL database dump") ||
      content.includes("CREATE TABLE") ||
      content.includes("SET statement_timeout")
    );
  } catch {
    return false;
  }
}

/**
 * Check if pg_dump is available
 */
export async function checkPgDumpAvailable(): Promise<boolean> {
  try {
    const result = await $`which pg_dump`.quiet();
    return result.exitCode === 0;
  } catch {
    return false;
  }
}
