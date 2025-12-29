/**
 * Tests for GFS (Grandfather-Father-Son) retention logic
 */

import { describe, it, expect } from "bun:test";
import { getISOWeek, getMonthKey, classifyBackups } from "../src/gfs";
import type { BackupManifest, GFSConfig } from "../src/types";

describe("gfs", () => {
  describe("getISOWeek", () => {
    it("should return correct week for mid-year date", () => {
      // June 15, 2025 is a Sunday in week 24
      const date = new Date("2025-06-15T12:00:00Z");
      const result = getISOWeek(date);
      expect(result.year).toBe(2025);
      expect(result.week).toBe(24);
    });

    it("should return correct week for first day of year", () => {
      // January 1, 2025 is a Wednesday - part of week 1
      const date = new Date("2025-01-01T00:00:00Z");
      const result = getISOWeek(date);
      expect(result.year).toBe(2025);
      expect(result.week).toBe(1);
    });

    it("should handle year boundary - late December belonging to next year week 1", () => {
      // December 29, 2025 is a Monday - first day of week 1 of 2026
      const date = new Date("2025-12-29T00:00:00Z");
      const result = getISOWeek(date);
      expect(result.year).toBe(2026);
      expect(result.week).toBe(1);
    });

    it("should handle year boundary - early January belonging to previous year week 52/53", () => {
      // January 1, 2021 is a Friday - belongs to week 53 of 2020
      const date = new Date("2021-01-01T00:00:00Z");
      const result = getISOWeek(date);
      expect(result.year).toBe(2020);
      expect(result.week).toBe(53);
    });

    it("should handle week 53 correctly", () => {
      // December 31, 2020 is a Thursday - week 53 of 2020
      const date = new Date("2020-12-31T00:00:00Z");
      const result = getISOWeek(date);
      expect(result.year).toBe(2020);
      expect(result.week).toBe(53);
    });

    it("should use Monday as first day of week", () => {
      // Sunday Dec 28, 2025 should be in same week as previous Monday
      const sunday = new Date("2025-12-28T00:00:00Z");
      const monday = new Date("2025-12-22T00:00:00Z");

      const sundayResult = getISOWeek(sunday);
      const mondayResult = getISOWeek(monday);

      expect(sundayResult.week).toBe(mondayResult.week);
      expect(sundayResult.year).toBe(mondayResult.year);
    });

    it("should return different weeks for Monday and previous Sunday", () => {
      // Monday Dec 29, 2025 starts week 1 of 2026
      // Sunday Dec 28, 2025 is still in week 52 of 2025
      const monday = new Date("2025-12-29T00:00:00Z");
      const sunday = new Date("2025-12-28T00:00:00Z");

      const mondayResult = getISOWeek(monday);
      const sundayResult = getISOWeek(sunday);

      expect(mondayResult.year).toBe(2026);
      expect(mondayResult.week).toBe(1);
      expect(sundayResult.year).toBe(2025);
      expect(sundayResult.week).toBe(52);
    });
  });

  describe("getMonthKey", () => {
    it("should return YYYY-MM format", () => {
      const date = new Date("2025-06-15T12:00:00Z");
      expect(getMonthKey(date)).toBe("2025-06");
    });

    it("should zero-pad single digit months", () => {
      const date = new Date("2025-01-15T12:00:00Z");
      expect(getMonthKey(date)).toBe("2025-01");
    });

    it("should handle December correctly", () => {
      const date = new Date("2025-12-31T23:59:59Z");
      expect(getMonthKey(date)).toBe("2025-12");
    });

    it("should use UTC month", () => {
      // January 1, 00:00 UTC - should be January
      const date = new Date("2025-01-01T00:00:00Z");
      expect(getMonthKey(date)).toBe("2025-01");
    });

    it("should handle year boundary", () => {
      const dec = new Date("2025-12-31T23:59:59Z");
      const jan = new Date("2026-01-01T00:00:00Z");

      expect(getMonthKey(dec)).toBe("2025-12");
      expect(getMonthKey(jan)).toBe("2026-01");
    });
  });

  // Helper to create test manifests
  function createManifest(id: string, timestamp: string): BackupManifest {
    return {
      id,
      timestamp,
      version: "0.1.0",
      database: { name: "testdb", size: 1000, checksum: "abc123" },
      directories: [],
      encrypted: false,
      status: "complete",
      duration: 60,
    };
  }

  describe("classifyBackups", () => {
    const defaultConfig: GFSConfig = {
      enabled: true,
      daily: 7,
      weekly: 4,
      monthly: 12,
    };

    describe("daily tier assignment", () => {
      it("should mark newest N backups as daily tier", () => {
        const manifests = [
          createManifest("backup-1", "2025-12-29T12:00:00Z"),
          createManifest("backup-2", "2025-12-28T12:00:00Z"),
          createManifest("backup-3", "2025-12-27T12:00:00Z"),
        ];

        const config: GFSConfig = { ...defaultConfig, daily: 2 };
        const result = classifyBackups(manifests, config);

        expect(result[0].tier).toBe("daily");
        expect(result[0].tierReason).toContain("newest");
        expect(result[1].tier).toBe("daily");
        expect(result[2].tier).not.toBe("daily");
      });

      it("should handle fewer backups than daily count", () => {
        const manifests = [
          createManifest("backup-1", "2025-12-29T12:00:00Z"),
          createManifest("backup-2", "2025-12-28T12:00:00Z"),
        ];

        const config: GFSConfig = { ...defaultConfig, daily: 7 };
        const result = classifyBackups(manifests, config);

        expect(result[0].tier).toBe("daily");
        expect(result[1].tier).toBe("daily");
        expect(result.length).toBe(2);
      });

      it("should sort manifests by timestamp before classification", () => {
        // Provide out of order
        const manifests = [
          createManifest("backup-old", "2025-12-27T12:00:00Z"),
          createManifest("backup-new", "2025-12-29T12:00:00Z"),
          createManifest("backup-mid", "2025-12-28T12:00:00Z"),
        ];

        const config: GFSConfig = { ...defaultConfig, daily: 2 };
        const result = classifyBackups(manifests, config);

        // Should be sorted newest first
        expect(result[0].manifest.id).toBe("backup-new");
        expect(result[1].manifest.id).toBe("backup-mid");
        expect(result[2].manifest.id).toBe("backup-old");

        // Newest 2 should be daily
        expect(result[0].tier).toBe("daily");
        expect(result[1].tier).toBe("daily");
      });

      it("should return empty array for empty input", () => {
        const result = classifyBackups([], defaultConfig);
        expect(result).toEqual([]);
      });
    });
  });
});
