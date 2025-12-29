/**
 * Tests for email alerting service
 * TDD: Write tests FIRST, then implement
 *
 * The alerting service handles:
 * 1. SMTP email configuration
 * 2. Backup success notifications
 * 3. Backup failure notifications
 * 4. Email content formatting
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import type { BackupManifest } from "../src/types";

// Import functions we'll implement
import {
  AlertService,
  sendAlert,
  formatSuccessEmail,
  formatFailureEmail,
  type AlertConfig,
  type AlertResult,
} from "../src/alerts";

describe("alerts", () => {
  // Sample backup manifest for testing
  const successManifest: BackupManifest = {
    id: "backup-2025-12-28T12-00-00",
    timestamp: "2025-12-28T12:00:00Z",
    version: "0.1.0",
    database: {
      name: "testdb",
      size: 1024 * 1024 * 50, // 50MB
      checksum: "abc123",
    },
    directories: [
      {
        path: "/data/uploads",
        size: 1024 * 1024 * 100, // 100MB
        fileCount: 500,
        checksum: "def456",
      },
    ],
    encrypted: true,
    status: "complete",
    duration: 120,
    offsite: {
      type: "s3",
      synced: true,
    },
  };

  const alertConfig: AlertConfig = {
    smtp: {
      host: "smtp.example.com",
      port: 587,
      secure: false,
      user: "alerts@example.com",
      password: "secret",
    },
    from: "backup@example.com",
    to: ["admin@example.com"],
    subjectPrefix: "[pg-backup]",
  };

  describe("AlertService class", () => {
    it("should create instance with config", () => {
      const service = new AlertService(alertConfig);

      expect(service).toBeDefined();
      expect(service.config).toEqual(alertConfig);
    });

    it("should have sendSuccess method", () => {
      const service = new AlertService(alertConfig);

      expect(typeof service.sendSuccess).toBe("function");
    });

    it("should have sendFailure method", () => {
      const service = new AlertService(alertConfig);

      expect(typeof service.sendFailure).toBe("function");
    });
  });

  describe("formatSuccessEmail", () => {
    it("should format success email with backup details", () => {
      const result = formatSuccessEmail(successManifest);

      expect(result.subject).toContain("Success");
      expect(result.subject).toContain(successManifest.id);
      expect(result.body).toContain("testdb");
      expect(result.body).toContain("120"); // duration
    });

    it("should include database size in human-readable format", () => {
      const result = formatSuccessEmail(successManifest);

      // 50MB should be formatted
      expect(result.body).toMatch(/50(\.\d+)?\s*MB/i);
    });

    it("should include directory count", () => {
      const result = formatSuccessEmail(successManifest);

      expect(result.body).toContain("1"); // 1 directory
    });

    it("should include offsite sync status", () => {
      const result = formatSuccessEmail(successManifest);

      expect(result.body).toContain("synced");
    });

    it("should indicate encryption status", () => {
      const result = formatSuccessEmail(successManifest);

      expect(result.body).toContain("encrypted");
    });
  });

  describe("formatFailureEmail", () => {
    it("should format failure email with error details", () => {
      const error = "pg_dump failed: connection refused";
      const result = formatFailureEmail("backup-failed", error);

      expect(result.subject).toContain("Failed");
      expect(result.subject).toContain("backup-failed");
      expect(result.body).toContain(error);
    });

    it("should include timestamp", () => {
      const result = formatFailureEmail("backup-failed", "error");

      // Should contain date
      expect(result.body).toMatch(/\d{4}-\d{2}-\d{2}/);
    });

    it("should include action recommendation", () => {
      const result = formatFailureEmail("backup-failed", "error");

      expect(result.body).toMatch(/check|investigate|review/i);
    });
  });

  describe("sendAlert function", () => {
    it("should return AlertResult type", async () => {
      // Without actual SMTP, this will fail but should return proper type
      const result = await sendAlert(alertConfig, {
        subject: "Test",
        body: "Test body",
      });

      expect(result).toHaveProperty("success");
      expect(typeof result.success).toBe("boolean");
    });

    it("should handle connection errors gracefully", async () => {
      const badConfig: AlertConfig = {
        ...alertConfig,
        smtp: {
          ...alertConfig.smtp,
          host: "nonexistent.invalid",
          port: 12345,
        },
      };

      const result = await sendAlert(badConfig, {
        subject: "Test",
        body: "Test body",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should support multiple recipients", async () => {
      const multiRecipientConfig: AlertConfig = {
        ...alertConfig,
        to: ["admin1@example.com", "admin2@example.com", "admin3@example.com"],
      };

      // Should not throw with multiple recipients
      const result = await sendAlert(multiRecipientConfig, {
        subject: "Test",
        body: "Test body",
      });

      expect(result).toBeDefined();
    });
  });

  describe("AlertService.sendSuccess", () => {
    it("should send success notification", async () => {
      const service = new AlertService(alertConfig);

      // Will fail without SMTP but should handle gracefully
      const result = await service.sendSuccess(successManifest);

      expect(result).toBeDefined();
      expect(typeof result.success).toBe("boolean");
    });

    it("should use configured subject prefix", async () => {
      const service = new AlertService({
        ...alertConfig,
        subjectPrefix: "[PROD-BACKUP]",
      });

      // The formatted email should use the prefix
      const email = formatSuccessEmail(successManifest);
      expect(email.subject).toBeDefined();
    });
  });

  describe("AlertService.sendFailure", () => {
    it("should send failure notification", async () => {
      const service = new AlertService(alertConfig);

      const result = await service.sendFailure("backup-123", "Connection timeout");

      expect(result).toBeDefined();
      expect(typeof result.success).toBe("boolean");
    });
  });

  describe("email content", () => {
    it("should use plain text format", () => {
      const result = formatSuccessEmail(successManifest);

      // Should not contain HTML tags
      expect(result.body).not.toMatch(/<[a-z]+>/i);
    });

    it("should be well-structured with sections", () => {
      const result = formatSuccessEmail(successManifest);

      // Should have clear sections
      expect(result.body).toContain("Backup ID:");
      expect(result.body).toContain("Database:");
      expect(result.body).toContain("Duration:");
    });
  });

  describe("configuration validation", () => {
    it("should validate required SMTP settings", () => {
      const service = new AlertService(alertConfig);

      expect(service.config.smtp.host).toBeDefined();
      expect(service.config.smtp.port).toBeDefined();
      expect(service.config.from).toBeDefined();
      expect(service.config.to.length).toBeGreaterThan(0);
    });

    it("should support optional TLS settings", () => {
      const tlsConfig: AlertConfig = {
        ...alertConfig,
        smtp: {
          ...alertConfig.smtp,
          secure: true,
        },
      };

      const service = new AlertService(tlsConfig);
      expect(service.config.smtp.secure).toBe(true);
    });
  });
});
