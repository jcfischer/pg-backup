/**
 * Tests for type definitions
 * Verifies that types are correctly structured and type guards work
 */

import { describe, it, expect } from "bun:test";
import type {
  DatabaseConfig,
  RetentionConfig,
  RsyncOffsiteConfig,
  S3OffsiteConfig,
  OffsiteConfig,
  SmtpConfig,
  AlertConfig,
  BackupConfig,
  BackupManifest,
  BackupResult,
  RestoreOptions,
  PruneResult,
  VerifyResult,
} from "../src/types";

describe("types", () => {
  describe("DatabaseConfig", () => {
    it("should accept valid database config", () => {
      const config: DatabaseConfig = {
        host: "localhost",
        port: 5432,
        name: "testdb",
        user: "postgres",
      };

      expect(config.host).toBe("localhost");
      expect(config.port).toBe(5432);
      expect(config.name).toBe("testdb");
      expect(config.user).toBe("postgres");
      expect(config.password).toBeUndefined();
    });

    it("should accept database config with password", () => {
      const config: DatabaseConfig = {
        host: "localhost",
        port: 5432,
        name: "testdb",
        user: "postgres",
        password: "secret",
      };

      expect(config.password).toBe("secret");
    });
  });

  describe("RetentionConfig", () => {
    it("should have days and minKeep", () => {
      const config: RetentionConfig = {
        days: 30,
        minKeep: 7,
      };

      expect(config.days).toBe(30);
      expect(config.minKeep).toBe(7);
    });
  });

  describe("OffsiteConfig", () => {
    it("should accept rsync config", () => {
      const config: RsyncOffsiteConfig = {
        type: "rsync",
        host: "backup.example.com",
        user: "backup",
        path: "/backups",
      };

      expect(config.type).toBe("rsync");
      expect(config.host).toBe("backup.example.com");
      expect(config.user).toBe("backup");
      expect(config.path).toBe("/backups");
      expect(config.sshKeyPath).toBeUndefined();
    });

    it("should accept rsync config with SSH key", () => {
      const config: RsyncOffsiteConfig = {
        type: "rsync",
        host: "backup.example.com",
        user: "backup",
        path: "/backups",
        sshKeyPath: "/home/user/.ssh/id_rsa",
      };

      expect(config.sshKeyPath).toBe("/home/user/.ssh/id_rsa");
    });

    it("should accept S3 config", () => {
      const config: S3OffsiteConfig = {
        type: "s3",
        endpoint: "https://s3.amazonaws.com",
        bucket: "my-backups",
        prefix: "pg-backup",
        accessKey: "AKIAIOSFODNN7EXAMPLE",
        secretKey: "wJalrXUtnFEMI/K7MDENG",
        region: "us-east-1",
      };

      expect(config.type).toBe("s3");
      expect(config.endpoint).toBe("https://s3.amazonaws.com");
      expect(config.bucket).toBe("my-backups");
      expect(config.prefix).toBe("pg-backup");
      expect(config.accessKey).toBe("AKIAIOSFODNN7EXAMPLE");
      expect(config.secretKey).toBe("wJalrXUtnFEMI/K7MDENG");
      expect(config.region).toBe("us-east-1");
    });

    it("should discriminate union type by type field", () => {
      const rsync: OffsiteConfig = {
        type: "rsync",
        host: "host",
        user: "user",
        path: "/path",
      };

      const s3: OffsiteConfig = {
        type: "s3",
        endpoint: "https://s3.amazonaws.com",
        bucket: "bucket",
        prefix: "",
        accessKey: "key",
        secretKey: "secret",
        region: "us-east-1",
      };

      // Type narrowing should work
      if (rsync.type === "rsync") {
        expect(rsync.host).toBe("host");
      }

      if (s3.type === "s3") {
        expect(s3.bucket).toBe("bucket");
      }
    });
  });

  describe("SmtpConfig", () => {
    it("should have all SMTP fields", () => {
      const config: SmtpConfig = {
        host: "smtp.example.com",
        port: 587,
        user: "user@example.com",
        password: "password",
        from: "noreply@example.com",
      };

      expect(config.host).toBe("smtp.example.com");
      expect(config.port).toBe(587);
      expect(config.user).toBe("user@example.com");
      expect(config.password).toBe("password");
      expect(config.from).toBe("noreply@example.com");
    });
  });

  describe("AlertConfig", () => {
    it("should have enabled flag, email, and smtp config", () => {
      const config: AlertConfig = {
        enabled: true,
        email: "admin@example.com",
        smtp: {
          host: "smtp.example.com",
          port: 587,
          user: "user",
          password: "pass",
          from: "noreply@example.com",
        },
      };

      expect(config.enabled).toBe(true);
      expect(config.email).toBe("admin@example.com");
      expect(config.smtp.host).toBe("smtp.example.com");
    });
  });

  describe("BackupConfig", () => {
    it("should accept minimal config", () => {
      const config: BackupConfig = {
        database: {
          host: "localhost",
          port: 5432,
          name: "testdb",
          user: "postgres",
        },
        directories: [],
        backupDir: "/var/backups",
        retention: {
          days: 30,
          minKeep: 7,
        },
      };

      expect(config.database.name).toBe("testdb");
      expect(config.directories).toEqual([]);
      expect(config.backupDir).toBe("/var/backups");
      expect(config.retention.days).toBe(30);
      expect(config.encryptionKey).toBeUndefined();
      expect(config.offsite).toBeUndefined();
      expect(config.alerts).toBeUndefined();
    });

    it("should accept full config", () => {
      const config: BackupConfig = {
        database: {
          host: "db.example.com",
          port: 5432,
          name: "production",
          user: "admin",
          password: "secret",
        },
        directories: ["/data/uploads", "/data/files"],
        backupDir: "/backups",
        retention: {
          days: 60,
          minKeep: 14,
        },
        encryptionKey: "mysecretkey",
        offsite: {
          type: "s3",
          endpoint: "https://s3.amazonaws.com",
          bucket: "backups",
          prefix: "prod",
          accessKey: "key",
          secretKey: "secret",
          region: "us-east-1",
        },
        alerts: {
          enabled: true,
          email: "ops@example.com",
          smtp: {
            host: "smtp.example.com",
            port: 587,
            user: "user",
            password: "pass",
            from: "backups@example.com",
          },
        },
      };

      expect(config.directories).toHaveLength(2);
      expect(config.encryptionKey).toBe("mysecretkey");
      expect(config.offsite?.type).toBe("s3");
      expect(config.alerts?.enabled).toBe(true);
    });
  });

  describe("BackupManifest", () => {
    it("should have all manifest fields", () => {
      const manifest: BackupManifest = {
        id: "backup-2025-12-28T12-00-00",
        timestamp: "2025-12-28T12:00:00Z",
        version: "0.1.0",
        database: {
          name: "testdb",
          size: 1024000,
          checksum: "abc123",
          tableCount: 42,
        },
        directories: [
          {
            path: "/data/uploads",
            size: 2048000,
            fileCount: 100,
            checksum: "def456",
          },
        ],
        encrypted: true,
        status: "complete",
        duration: 120,
      };

      expect(manifest.id).toBe("backup-2025-12-28T12-00-00");
      expect(manifest.database.tableCount).toBe(42);
      expect(manifest.directories).toHaveLength(1);
      expect(manifest.encrypted).toBe(true);
      expect(manifest.status).toBe("complete");
      expect(manifest.duration).toBe(120);
    });

    it("should accept offsite sync info", () => {
      const manifest: BackupManifest = {
        id: "backup-123",
        timestamp: "2025-12-28T12:00:00Z",
        version: "0.1.0",
        database: {
          name: "db",
          size: 1000,
          checksum: "xyz",
        },
        directories: [],
        encrypted: false,
        status: "complete",
        duration: 60,
        offsite: {
          synced: true,
          syncedAt: "2025-12-28T12:05:00Z",
          type: "s3",
        },
      };

      expect(manifest.offsite?.synced).toBe(true);
      expect(manifest.offsite?.type).toBe("s3");
    });

    it("should accept different status values", () => {
      const complete: BackupManifest = {
        id: "1",
        timestamp: "",
        version: "",
        database: { name: "", size: 0, checksum: "" },
        directories: [],
        encrypted: false,
        status: "complete",
        duration: 0,
      };

      const failed: BackupManifest = { ...complete, id: "2", status: "failed" };
      const partial: BackupManifest = { ...complete, id: "3", status: "partial" };

      expect(complete.status).toBe("complete");
      expect(failed.status).toBe("failed");
      expect(partial.status).toBe("partial");
    });
  });

  describe("BackupResult", () => {
    it("should accept success result", () => {
      const result: BackupResult = {
        success: true,
        backupPath: "/backups/backup-123",
        manifest: {
          id: "backup-123",
          timestamp: "2025-12-28T12:00:00Z",
          version: "0.1.0",
          database: { name: "db", size: 1000, checksum: "abc" },
          directories: [],
          encrypted: false,
          status: "complete",
          duration: 60,
        },
      };

      expect(result.success).toBe(true);
      expect(result.backupPath).toBe("/backups/backup-123");
      expect(result.manifest?.id).toBe("backup-123");
    });

    it("should accept failure result", () => {
      const result: BackupResult = {
        success: false,
        error: "Database connection failed",
      };

      expect(result.success).toBe(false);
      expect(result.error).toBe("Database connection failed");
    });
  });

  describe("RestoreOptions", () => {
    it("should accept all options", () => {
      const options: RestoreOptions = {
        targetDatabase: "restore_db",
        skipDirectories: true,
        skipDatabase: false,
      };

      expect(options.targetDatabase).toBe("restore_db");
      expect(options.skipDirectories).toBe(true);
      expect(options.skipDatabase).toBe(false);
    });

    it("should allow empty options", () => {
      const options: RestoreOptions = {};

      expect(options.targetDatabase).toBeUndefined();
      expect(options.skipDirectories).toBeUndefined();
      expect(options.skipDatabase).toBeUndefined();
    });
  });

  describe("PruneResult", () => {
    it("should have deleted, kept, and errors arrays", () => {
      const result: PruneResult = {
        deleted: ["backup-1", "backup-2"],
        kept: ["backup-3", "backup-4", "backup-5"],
        errors: [],
      };

      expect(result.deleted).toHaveLength(2);
      expect(result.kept).toHaveLength(3);
      expect(result.errors).toHaveLength(0);
    });

    it("should include errors when deletion fails", () => {
      const result: PruneResult = {
        deleted: ["backup-1"],
        kept: ["backup-3"],
        errors: ["Failed to delete backup-2: Permission denied"],
      };

      expect(result.errors).toHaveLength(1);
    });
  });

  describe("VerifyResult", () => {
    it("should have validation flags and errors", () => {
      const result: VerifyResult = {
        valid: true,
        checksumValid: true,
        databaseRestoreTest: true,
        errors: [],
      };

      expect(result.valid).toBe(true);
      expect(result.checksumValid).toBe(true);
      expect(result.databaseRestoreTest).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should capture verification failures", () => {
      const result: VerifyResult = {
        valid: false,
        checksumValid: false,
        errors: ["Checksum mismatch for database.sql.gz"],
      };

      expect(result.valid).toBe(false);
      expect(result.checksumValid).toBe(false);
      expect(result.databaseRestoreTest).toBeUndefined();
      expect(result.errors).toContain("Checksum mismatch for database.sql.gz");
    });
  });
});
