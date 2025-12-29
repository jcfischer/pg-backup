/**
 * Tests for configuration loading
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { loadConfig, validateConfig } from "../src/config";
import type { BackupConfig } from "../src/types";

describe("config", () => {
  // Store original env
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // Clear all PG_BACKUP_ env vars
    Object.keys(process.env)
      .filter((key) => key.startsWith("PG_BACKUP_"))
      .forEach((key) => delete process.env[key]);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("loadConfig", () => {
    it("should throw when required DB_NAME is missing", () => {
      expect(() => loadConfig()).toThrow("PG_BACKUP_DB_NAME");
    });

    it("should load minimal config with defaults", () => {
      process.env.PG_BACKUP_DB_NAME = "testdb";

      const config = loadConfig();

      expect(config.database.name).toBe("testdb");
      expect(config.database.host).toBe("localhost");
      expect(config.database.port).toBe(5432);
      expect(config.database.user).toBe("postgres");
      expect(config.backupDir).toBe("/var/backups/pg-backup");
      expect(config.retention.days).toBe(30);
      expect(config.retention.minKeep).toBe(7);
    });

    it("should load custom database config from env", () => {
      process.env.PG_BACKUP_DB_NAME = "mydb";
      process.env.PG_BACKUP_DB_HOST = "db.example.com";
      process.env.PG_BACKUP_DB_PORT = "5433";
      process.env.PG_BACKUP_DB_USER = "admin";
      process.env.PG_BACKUP_DB_PASSWORD = "secret123";

      const config = loadConfig();

      expect(config.database.name).toBe("mydb");
      expect(config.database.host).toBe("db.example.com");
      expect(config.database.port).toBe(5433);
      expect(config.database.user).toBe("admin");
      expect(config.database.password).toBe("secret123");
    });

    it("should load directory list from env", () => {
      process.env.PG_BACKUP_DB_NAME = "testdb";
      process.env.PG_BACKUP_DIRS = "/data/uploads, /data/files, /var/log/app";

      const config = loadConfig();

      expect(config.directories).toEqual([
        "/data/uploads",
        "/data/files",
        "/var/log/app",
      ]);
    });

    it("should load retention config from env", () => {
      process.env.PG_BACKUP_DB_NAME = "testdb";
      process.env.PG_BACKUP_RETENTION_DAYS = "60";
      process.env.PG_BACKUP_MIN_KEEP = "14";

      const config = loadConfig();

      expect(config.retention.days).toBe(60);
      expect(config.retention.minKeep).toBe(14);
    });

    it("should load encryption key from env", () => {
      process.env.PG_BACKUP_DB_NAME = "testdb";
      process.env.PG_BACKUP_ENCRYPTION_KEY = "mysecretkey";

      const config = loadConfig();

      expect(config.encryptionKey).toBe("mysecretkey");
    });

    it("should load rsync offsite config", () => {
      process.env.PG_BACKUP_DB_NAME = "testdb";
      process.env.PG_BACKUP_OFFSITE_TYPE = "rsync";
      process.env.PG_BACKUP_OFFSITE_HOST = "backup.example.com";
      process.env.PG_BACKUP_OFFSITE_USER = "backupuser";
      process.env.PG_BACKUP_OFFSITE_PATH = "/backups/myapp";
      process.env.PG_BACKUP_OFFSITE_SSH_KEY = "/home/user/.ssh/backup_key";

      const config = loadConfig();

      expect(config.offsite).toBeDefined();
      expect(config.offsite?.type).toBe("rsync");
      if (config.offsite?.type === "rsync") {
        expect(config.offsite.host).toBe("backup.example.com");
        expect(config.offsite.user).toBe("backupuser");
        expect(config.offsite.path).toBe("/backups/myapp");
        expect(config.offsite.sshKeyPath).toBe("/home/user/.ssh/backup_key");
      }
    });

    it("should load S3 offsite config", () => {
      process.env.PG_BACKUP_DB_NAME = "testdb";
      process.env.PG_BACKUP_OFFSITE_TYPE = "s3";
      process.env.PG_BACKUP_S3_ENDPOINT = "https://s3.eu-central-1.amazonaws.com";
      process.env.PG_BACKUP_S3_BUCKET = "my-backups";
      process.env.PG_BACKUP_S3_PREFIX = "pg-backup/myapp";
      process.env.PG_BACKUP_S3_ACCESS_KEY = "AKIAIOSFODNN7EXAMPLE";
      process.env.PG_BACKUP_S3_SECRET_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
      process.env.PG_BACKUP_S3_REGION = "eu-central-1";

      const config = loadConfig();

      expect(config.offsite).toBeDefined();
      expect(config.offsite?.type).toBe("s3");
      if (config.offsite?.type === "s3") {
        expect(config.offsite.endpoint).toBe("https://s3.eu-central-1.amazonaws.com");
        expect(config.offsite.bucket).toBe("my-backups");
        expect(config.offsite.prefix).toBe("pg-backup/myapp");
        expect(config.offsite.accessKey).toBe("AKIAIOSFODNN7EXAMPLE");
        expect(config.offsite.secretKey).toBe("wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");
        expect(config.offsite.region).toBe("eu-central-1");
      }
    });

    it("should load alert config from env", () => {
      process.env.PG_BACKUP_DB_NAME = "testdb";
      process.env.PG_BACKUP_ALERT_EMAIL = "admin@example.com";
      process.env.PG_BACKUP_SMTP_HOST = "smtp.example.com";
      process.env.PG_BACKUP_SMTP_PORT = "465";
      process.env.PG_BACKUP_SMTP_USER = "smtp-user";
      process.env.PG_BACKUP_SMTP_PASS = "smtp-pass";
      process.env.PG_BACKUP_SMTP_FROM = "backups@example.com";

      const config = loadConfig();

      expect(config.alerts).toBeDefined();
      expect(config.alerts?.enabled).toBe(true);
      expect(config.alerts?.email).toBe("admin@example.com");
      expect(config.alerts?.smtp.host).toBe("smtp.example.com");
      expect(config.alerts?.smtp.port).toBe(465);
      expect(config.alerts?.smtp.user).toBe("smtp-user");
      expect(config.alerts?.smtp.password).toBe("smtp-pass");
      expect(config.alerts?.smtp.from).toBe("backups@example.com");
    });

    it("should not set offsite when type is unknown", () => {
      process.env.PG_BACKUP_DB_NAME = "testdb";
      process.env.PG_BACKUP_OFFSITE_TYPE = "ftp"; // Unsupported

      const config = loadConfig();

      expect(config.offsite).toBeUndefined();
    });

    it("should not set S3 offsite when missing required fields", () => {
      process.env.PG_BACKUP_DB_NAME = "testdb";
      process.env.PG_BACKUP_OFFSITE_TYPE = "s3";
      // Missing bucket and endpoint

      const config = loadConfig();

      expect(config.offsite).toBeUndefined();
    });
  });

  describe("validateConfig", () => {
    it("should return no errors for valid config", () => {
      const config: BackupConfig = {
        database: {
          host: "localhost",
          port: 5432,
          name: "testdb",
          user: "postgres",
        },
        directories: [],
        backupDir: "/var/backups",
        retention: { days: 30, minKeep: 7 },
      };

      const errors = validateConfig(config);

      expect(errors).toEqual([]);
    });

    it("should return error when database name is missing", () => {
      const config: BackupConfig = {
        database: {
          host: "localhost",
          port: 5432,
          name: "",
          user: "postgres",
        },
        directories: [],
        backupDir: "/var/backups",
        retention: { days: 30, minKeep: 7 },
      };

      const errors = validateConfig(config);

      expect(errors).toContain("Database name is required (PG_BACKUP_DB_NAME)");
    });

    it("should return error when backup dir is missing", () => {
      const config: BackupConfig = {
        database: {
          host: "localhost",
          port: 5432,
          name: "testdb",
          user: "postgres",
        },
        directories: [],
        backupDir: "",
        retention: { days: 30, minKeep: 7 },
      };

      const errors = validateConfig(config);

      expect(errors).toContain("Backup directory is required (PG_BACKUP_DIR)");
    });

    it("should return errors for incomplete S3 config", () => {
      const config: BackupConfig = {
        database: {
          host: "localhost",
          port: 5432,
          name: "testdb",
          user: "postgres",
        },
        directories: [],
        backupDir: "/var/backups",
        retention: { days: 30, minKeep: 7 },
        offsite: {
          type: "s3",
          endpoint: "",
          bucket: "",
          prefix: "",
          accessKey: "key",
          secretKey: "secret",
          region: "auto",
        },
      };

      const errors = validateConfig(config);

      expect(errors).toContain("S3 endpoint is required (PG_BACKUP_S3_ENDPOINT)");
      expect(errors).toContain("S3 bucket is required (PG_BACKUP_S3_BUCKET)");
    });
  });
});
