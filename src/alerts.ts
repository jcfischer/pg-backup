/**
 * Email alerting service for backup notifications
 * Sends SMTP emails on backup success/failure
 */

import type { BackupManifest } from "./types";

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
}

export interface AlertConfig {
  smtp: SmtpConfig;
  from: string;
  to: string[];
  subjectPrefix?: string;
}

export interface EmailContent {
  subject: string;
  body: string;
}

export interface AlertResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * AlertService class for sending backup notifications
 */
export class AlertService {
  public config: AlertConfig;

  constructor(config: AlertConfig) {
    this.config = config;
  }

  /**
   * Send success notification
   */
  async sendSuccess(manifest: BackupManifest): Promise<AlertResult> {
    const email = formatSuccessEmail(manifest);
    const subject = this.config.subjectPrefix
      ? `${this.config.subjectPrefix} ${email.subject}`
      : email.subject;

    return sendAlert(this.config, { subject, body: email.body });
  }

  /**
   * Send failure notification
   */
  async sendFailure(backupId: string, error: string): Promise<AlertResult> {
    const email = formatFailureEmail(backupId, error);
    const subject = this.config.subjectPrefix
      ? `${this.config.subjectPrefix} ${email.subject}`
      : email.subject;

    return sendAlert(this.config, { subject, body: email.body });
  }
}

/**
 * Format bytes to human-readable size
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Format duration in seconds to human-readable format
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) return `${minutes}m ${secs}s`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

/**
 * Format success email content
 */
export function formatSuccessEmail(manifest: BackupManifest): EmailContent {
  const timestamp = new Date(manifest.timestamp).toLocaleString();
  const dbSize = formatBytes(manifest.database.size);
  const totalDirSize = manifest.directories.reduce((sum, d) => sum + d.size, 0);
  const totalFiles = manifest.directories.reduce((sum, d) => sum + d.fileCount, 0);

  const subject = `Backup Success: ${manifest.id}`;

  const lines = [
    "=".repeat(50),
    "BACKUP COMPLETED SUCCESSFULLY",
    "=".repeat(50),
    "",
    `Backup ID: ${manifest.id}`,
    `Timestamp: ${timestamp}`,
    `Duration: ${manifest.duration}s (${formatDuration(manifest.duration)})`,
    "",
    "-".repeat(50),
    "DATABASE",
    "-".repeat(50),
    `Database: ${manifest.database.name}`,
    `Size: ${dbSize}`,
    `Checksum: ${manifest.database.checksum}`,
    "",
  ];

  if (manifest.directories.length > 0) {
    lines.push("-".repeat(50));
    lines.push("DIRECTORIES");
    lines.push("-".repeat(50));
    lines.push(`Count: ${manifest.directories.length}`);
    lines.push(`Total Size: ${formatBytes(totalDirSize)}`);
    lines.push(`Total Files: ${totalFiles}`);
    lines.push("");
    for (const dir of manifest.directories) {
      lines.push(`  - ${dir.path}: ${formatBytes(dir.size)} (${dir.fileCount} files)`);
    }
    lines.push("");
  }

  lines.push("-".repeat(50));
  lines.push("STATUS");
  lines.push("-".repeat(50));
  lines.push(`Encryption: ${manifest.encrypted ? "encrypted" : "not encrypted"}`);

  if (manifest.offsite) {
    lines.push(`Offsite (${manifest.offsite.type}): ${manifest.offsite.synced ? "synced" : "not synced"}`);
  }

  lines.push("");
  lines.push("=".repeat(50));
  lines.push("This is an automated message from pg-backup.");
  lines.push("=".repeat(50));

  return {
    subject,
    body: lines.join("\n"),
  };
}

/**
 * Format failure email content
 */
export function formatFailureEmail(backupId: string, error: string): EmailContent {
  const timestamp = new Date().toISOString();

  const subject = `Backup Failed: ${backupId}`;

  const lines = [
    "!".repeat(50),
    "BACKUP FAILED - IMMEDIATE ATTENTION REQUIRED",
    "!".repeat(50),
    "",
    `Backup ID: ${backupId}`,
    `Timestamp: ${timestamp}`,
    "",
    "-".repeat(50),
    "ERROR DETAILS",
    "-".repeat(50),
    error,
    "",
    "-".repeat(50),
    "RECOMMENDED ACTIONS",
    "-".repeat(50),
    "1. Check database connectivity",
    "2. Verify disk space availability",
    "3. Review backup logs for more details",
    "4. Investigate and resolve the issue",
    "5. Manually trigger a new backup once resolved",
    "",
    "!".repeat(50),
    "This is an automated message from pg-backup.",
    "!".repeat(50),
  ];

  return {
    subject,
    body: lines.join("\n"),
  };
}

/**
 * Send email alert via SMTP
 * Uses native fetch to a simple SMTP relay or falls back gracefully
 */
export async function sendAlert(
  config: AlertConfig,
  email: EmailContent
): Promise<AlertResult> {
  try {
    // Try to use nodemailer if available
    const nodemailer = await import("nodemailer").catch(() => null);

    if (nodemailer) {
      const transporter = nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.secure,
        auth: {
          user: config.smtp.user,
          pass: config.smtp.password,
        },
        connectionTimeout: 10000, // 10 second timeout
      });

      const info = await transporter.sendMail({
        from: config.from,
        to: config.to.join(", "),
        subject: email.subject,
        text: email.body,
      });

      return {
        success: true,
        messageId: info.messageId,
      };
    }

    // Fallback: Log the email (useful for testing/development)
    console.log(`[ALERT] Would send email to: ${config.to.join(", ")}`);
    console.log(`[ALERT] Subject: ${email.subject}`);
    console.log(`[ALERT] Body:\n${email.body}`);

    return {
      success: false,
      error: "nodemailer not available - email logged to console",
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
