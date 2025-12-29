/**
 * S3-compatible offsite backup sync
 * Works with AWS S3, Backblaze B2, MinIO, Cloudflare R2, DigitalOcean Spaces
 */

import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { existsSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import { basename } from "path";
import type { S3OffsiteConfig } from "./types";

export interface S3SyncResult {
  success: boolean;
  uploaded: string[];
  errors: string[];
}

export interface S3ListResult {
  success: boolean;
  files: Array<{
    key: string;
    size: number;
    lastModified: Date;
  }>;
  error?: string;
}

export interface S3DownloadResult {
  success: boolean;
  localPath: string;
  error?: string;
}

function createS3Client(config: S3OffsiteConfig): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.accessKey,
      secretAccessKey: config.secretKey,
    },
    // Force path-style for non-AWS S3-compatible services
    forcePathStyle: !config.endpoint.includes("amazonaws.com"),
  });
}

function buildS3Key(config: S3OffsiteConfig, filename: string): string {
  const prefix = config.prefix ? config.prefix.replace(/\/$/, "") : "";
  return prefix ? `${prefix}/${filename}` : filename;
}

/**
 * Upload a file to S3-compatible storage
 */
export async function uploadToS3(
  config: S3OffsiteConfig,
  localPath: string,
  remoteFilename?: string
): Promise<{ success: boolean; key: string; error?: string }> {
  if (!existsSync(localPath)) {
    return {
      success: false,
      key: "",
      error: `Local file not found: ${localPath}`,
    };
  }

  const client = createS3Client(config);
  const filename = remoteFilename ?? basename(localPath);
  const key = buildS3Key(config, filename);

  try {
    const fileContent = await readFile(localPath);

    await client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: fileContent,
      })
    );

    return { success: true, key };
  } catch (error) {
    return {
      success: false,
      key,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Upload multiple files to S3
 */
export async function syncToS3(
  config: S3OffsiteConfig,
  localPaths: string[]
): Promise<S3SyncResult> {
  const uploaded: string[] = [];
  const errors: string[] = [];

  for (const localPath of localPaths) {
    const result = await uploadToS3(config, localPath);
    if (result.success) {
      uploaded.push(result.key);
    } else {
      errors.push(`${localPath}: ${result.error}`);
    }
  }

  return {
    success: errors.length === 0,
    uploaded,
    errors,
  };
}

/**
 * Download a file from S3-compatible storage
 */
export async function downloadFromS3(
  config: S3OffsiteConfig,
  remoteFilename: string,
  localPath: string
): Promise<S3DownloadResult> {
  const client = createS3Client(config);
  const key = buildS3Key(config, remoteFilename);

  try {
    const response = await client.send(
      new GetObjectCommand({
        Bucket: config.bucket,
        Key: key,
      })
    );

    if (!response.Body) {
      return {
        success: false,
        localPath,
        error: "Empty response body",
      };
    }

    // Convert stream to buffer
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    await writeFile(localPath, buffer);

    return { success: true, localPath };
  } catch (error) {
    return {
      success: false,
      localPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * List files in S3 bucket with optional prefix
 */
export async function listS3Files(
  config: S3OffsiteConfig,
  additionalPrefix?: string
): Promise<S3ListResult> {
  const client = createS3Client(config);

  let prefix = config.prefix ? config.prefix.replace(/\/$/, "") : "";
  if (additionalPrefix) {
    prefix = prefix ? `${prefix}/${additionalPrefix}` : additionalPrefix;
  }

  try {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: prefix || undefined,
      })
    );

    const files = (response.Contents ?? []).map((obj) => ({
      key: obj.Key ?? "",
      size: obj.Size ?? 0,
      lastModified: obj.LastModified ?? new Date(),
    }));

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
 * Delete a file from S3
 */
export async function deleteFromS3(
  config: S3OffsiteConfig,
  remoteFilename: string
): Promise<{ success: boolean; error?: string }> {
  const client = createS3Client(config);
  const key = buildS3Key(config, remoteFilename);

  try {
    await client.send(
      new DeleteObjectCommand({
        Bucket: config.bucket,
        Key: key,
      })
    );

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check if a file exists in S3
 */
export async function existsInS3(
  config: S3OffsiteConfig,
  remoteFilename: string
): Promise<boolean> {
  const client = createS3Client(config);
  const key = buildS3Key(config, remoteFilename);

  try {
    await client.send(
      new HeadObjectCommand({
        Bucket: config.bucket,
        Key: key,
      })
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if S3 connection is valid
 */
export async function checkS3Connection(
  config: S3OffsiteConfig
): Promise<{ success: boolean; error?: string }> {
  const client = createS3Client(config);

  try {
    // Try to list with max 1 result to verify credentials
    await client.send(
      new ListObjectsV2Command({
        Bucket: config.bucket,
        MaxKeys: 1,
      })
    );

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
