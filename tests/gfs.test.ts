/**
 * Tests for GFS (Grandfather-Father-Son) retention logic
 */

import { describe, it, expect } from "bun:test";
import { getISOWeek, getMonthKey, classifyBackups, getBackupsToPrune } from "../src/gfs";
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

    describe("weekly tier promotion", () => {
      it("should promote oldest backup in each week to weekly tier", () => {
        // Create backups across 3 different weeks
        // Week 52 of 2025: Dec 22-28
        // Week 1 of 2026: Dec 29 - Jan 4
        const manifests = [
          createManifest("backup-w1-1", "2025-12-29T12:00:00Z"), // Week 1/2026 - newest
          createManifest("backup-w52-3", "2025-12-28T12:00:00Z"), // Week 52/2025
          createManifest("backup-w52-2", "2025-12-25T12:00:00Z"), // Week 52/2025
          createManifest("backup-w52-1", "2025-12-22T12:00:00Z"), // Week 52/2025 - oldest in week
          createManifest("backup-w51-2", "2025-12-21T12:00:00Z"), // Week 51/2025
          createManifest("backup-w51-1", "2025-12-15T12:00:00Z"), // Week 51/2025 - oldest in week
        ];

        const config: GFSConfig = { enabled: true, daily: 1, weekly: 4, monthly: 12 };
        const result = classifyBackups(manifests, config);

        // First should be daily
        expect(result[0].tier).toBe("daily");
        expect(result[0].manifest.id).toBe("backup-w1-1");

        // Oldest in week 52 should be weekly
        const w52Oldest = result.find((r) => r.manifest.id === "backup-w52-1");
        expect(w52Oldest?.tier).toBe("weekly");
        expect(w52Oldest?.tierReason).toContain("week");

        // Oldest in week 51 should be weekly
        const w51Oldest = result.find((r) => r.manifest.id === "backup-w51-1");
        expect(w51Oldest?.tier).toBe("weekly");

        // Others in same weeks should be prunable
        const w52Mid = result.find((r) => r.manifest.id === "backup-w52-2");
        expect(w52Mid?.tier).toBe("prunable");
      });

      it("should not exceed weekly retention count", () => {
        // 10 backups across 10 weeks, but only keep 2 weekly
        const manifests: BackupManifest[] = [];
        for (let i = 0; i < 10; i++) {
          const date = new Date("2025-06-01T12:00:00Z");
          date.setDate(date.getDate() - i * 7); // One per week
          manifests.push(createManifest(`backup-${i}`, date.toISOString()));
        }

        const config: GFSConfig = { enabled: true, daily: 1, weekly: 2, monthly: 12 };
        const result = classifyBackups(manifests, config);

        const weeklyCount = result.filter((r) => r.tier === "weekly").length;
        expect(weeklyCount).toBe(2);
      });

      it("should use oldest backup in week for promotion", () => {
        // Multiple backups in same week
        const manifests = [
          createManifest("monday-late", "2025-12-22T18:00:00Z"),
          createManifest("monday-early", "2025-12-22T06:00:00Z"), // Same day, earlier - should be promoted
        ];

        const config: GFSConfig = { enabled: true, daily: 0, weekly: 4, monthly: 12 };
        const result = classifyBackups(manifests, config);

        const promoted = result.find((r) => r.tier === "weekly");
        expect(promoted?.manifest.id).toBe("monday-early");
      });
    });

    describe("monthly tier promotion", () => {
      it("should promote oldest backup in each month to monthly tier", () => {
        // Create backups across multiple months
        const manifests = [
          createManifest("dec-new", "2025-12-28T12:00:00Z"),
          createManifest("dec-old", "2025-12-01T12:00:00Z"), // Oldest in December
          createManifest("nov-new", "2025-11-28T12:00:00Z"),
          createManifest("nov-old", "2025-11-01T12:00:00Z"), // Oldest in November
          createManifest("oct-old", "2025-10-15T12:00:00Z"), // Only one in October
        ];

        const config: GFSConfig = { enabled: true, daily: 1, weekly: 0, monthly: 12 };
        const result = classifyBackups(manifests, config);

        // First should be daily
        expect(result[0].tier).toBe("daily");

        // Oldest in each month should be monthly
        const decOldest = result.find((r) => r.manifest.id === "dec-old");
        expect(decOldest?.tier).toBe("monthly");
        expect(decOldest?.tierReason).toContain("2025-12");

        const novOldest = result.find((r) => r.manifest.id === "nov-old");
        expect(novOldest?.tier).toBe("monthly");
        expect(novOldest?.tierReason).toContain("2025-11");

        const octOldest = result.find((r) => r.manifest.id === "oct-old");
        expect(octOldest?.tier).toBe("monthly");

        // Others should be prunable
        const novNew = result.find((r) => r.manifest.id === "nov-new");
        expect(novNew?.tier).toBe("prunable");
      });

      it("should not exceed monthly retention count", () => {
        // 15 backups across 15 months, but only keep 3 monthly
        const manifests: BackupManifest[] = [];
        for (let i = 0; i < 15; i++) {
          const date = new Date("2025-12-15T12:00:00Z");
          date.setMonth(date.getMonth() - i);
          manifests.push(createManifest(`backup-${i}`, date.toISOString()));
        }

        const config: GFSConfig = { enabled: true, daily: 1, weekly: 0, monthly: 3 };
        const result = classifyBackups(manifests, config);

        const monthlyCount = result.filter((r) => r.tier === "monthly").length;
        expect(monthlyCount).toBe(3);
      });

      it("should use oldest backup in month for promotion", () => {
        // Multiple backups in same month
        const manifests = [
          createManifest("mid-month", "2025-12-15T12:00:00Z"),
          createManifest("start-month", "2025-12-01T12:00:00Z"), // Should be promoted
        ];

        const config: GFSConfig = { enabled: true, daily: 0, weekly: 0, monthly: 12 };
        const result = classifyBackups(manifests, config);

        const promoted = result.find((r) => r.tier === "monthly");
        expect(promoted?.manifest.id).toBe("start-month");
      });

      it("should handle backups already promoted to weekly", () => {
        // Weekly gets priority over monthly for same backup
        const manifests = [
          createManifest("w52-dec", "2025-12-22T12:00:00Z"), // Oldest in week 52, also oldest in Dec
          createManifest("w51-dec", "2025-12-15T12:00:00Z"), // Week 51, in December
        ];

        const config: GFSConfig = { enabled: true, daily: 0, weekly: 2, monthly: 2 };
        const result = classifyBackups(manifests, config);

        // Both should be weekly (one per week)
        expect(result.filter((r) => r.tier === "weekly").length).toBe(2);

        // Monthly should not double-count a weekly backup
        expect(result.filter((r) => r.tier === "monthly").length).toBe(0);
      });
    });

    describe("prunable classification", () => {
      it("should mark backups exceeding all tier limits as prunable", () => {
        // 10 backups, but only 2 daily + 1 weekly + 1 monthly = 4 kept
        const manifests: BackupManifest[] = [];
        for (let i = 0; i < 10; i++) {
          const date = new Date("2025-12-29T12:00:00Z");
          date.setDate(date.getDate() - i * 3); // Every 3 days
          manifests.push(createManifest(`backup-${i}`, date.toISOString()));
        }

        const config: GFSConfig = { enabled: true, daily: 2, weekly: 1, monthly: 1 };
        const result = classifyBackups(manifests, config);

        const prunable = result.filter((r) => r.tier === "prunable");
        expect(prunable.length).toBeGreaterThan(0);

        // Verify prunable backups have correct reason
        for (const p of prunable) {
          expect(p.tierReason).toBe("exceeds retention");
        }
      });

      it("should not mark any backups as prunable when all fit in tiers", () => {
        const manifests = [
          createManifest("backup-1", "2025-12-29T12:00:00Z"),
          createManifest("backup-2", "2025-12-28T12:00:00Z"),
        ];

        const config: GFSConfig = { enabled: true, daily: 5, weekly: 4, monthly: 12 };
        const result = classifyBackups(manifests, config);

        const prunable = result.filter((r) => r.tier === "prunable");
        expect(prunable.length).toBe(0);
      });

      it("should mark all backups as prunable when all tier counts are zero", () => {
        const manifests = [
          createManifest("backup-1", "2025-12-29T12:00:00Z"),
          createManifest("backup-2", "2025-12-28T12:00:00Z"),
        ];

        const config: GFSConfig = { enabled: true, daily: 0, weekly: 0, monthly: 0 };
        const result = classifyBackups(manifests, config);

        expect(result.every((r) => r.tier === "prunable")).toBe(true);
      });
    });

    describe("tier priority rules", () => {
      it("should not double-count daily backups as weekly", () => {
        // A backup in daily tier should not also appear as weekly
        const manifests = [
          createManifest("newest", "2025-12-29T12:00:00Z"), // Will be daily, also oldest in its week
          createManifest("older", "2025-12-22T12:00:00Z"), // Different week
        ];

        const config: GFSConfig = { enabled: true, daily: 1, weekly: 2, monthly: 0 };
        const result = classifyBackups(manifests, config);

        // First should be daily
        expect(result.find((r) => r.manifest.id === "newest")?.tier).toBe("daily");

        // Second should be weekly (oldest in its week)
        expect(result.find((r) => r.manifest.id === "older")?.tier).toBe("weekly");

        // Total should be 2 (no duplicates)
        expect(result.length).toBe(2);
      });

      it("should not double-count daily backups as monthly", () => {
        // A backup in daily tier should not also appear as monthly
        const manifests = [
          createManifest("newest", "2025-12-01T12:00:00Z"), // Will be daily, also oldest in December
          createManifest("older", "2025-11-15T12:00:00Z"), // Different month
        ];

        const config: GFSConfig = { enabled: true, daily: 1, weekly: 0, monthly: 2 };
        const result = classifyBackups(manifests, config);

        // First should be daily
        expect(result.find((r) => r.manifest.id === "newest")?.tier).toBe("daily");

        // Second should be monthly (oldest in November)
        expect(result.find((r) => r.manifest.id === "older")?.tier).toBe("monthly");

        // Total should be 2 (no duplicates)
        expect(result.length).toBe(2);
      });

      it("should assign each backup to exactly one tier", () => {
        // Complex scenario with overlapping periods
        const manifests = [
          createManifest("a", "2025-12-29T12:00:00Z"), // Newest - daily
          createManifest("b", "2025-12-28T12:00:00Z"), // Daily
          createManifest("c", "2025-12-22T12:00:00Z"), // Oldest in week 52 - weekly
          createManifest("d", "2025-12-15T12:00:00Z"), // Oldest in week 51 - weekly
          createManifest("e", "2025-12-01T12:00:00Z"), // Oldest in Dec (but earlier weeks taken) - monthly
          createManifest("f", "2025-11-01T12:00:00Z"), // Oldest in Nov - monthly
        ];

        const config: GFSConfig = { enabled: true, daily: 2, weekly: 2, monthly: 2 };
        const result = classifyBackups(manifests, config);

        // Each backup should appear exactly once
        expect(result.length).toBe(manifests.length);

        // Verify tier assignments
        expect(result.find((r) => r.manifest.id === "a")?.tier).toBe("daily");
        expect(result.find((r) => r.manifest.id === "b")?.tier).toBe("daily");
        expect(result.find((r) => r.manifest.id === "c")?.tier).toBe("weekly");
        expect(result.find((r) => r.manifest.id === "d")?.tier).toBe("weekly");
        expect(result.find((r) => r.manifest.id === "e")?.tier).toBe("monthly");
        expect(result.find((r) => r.manifest.id === "f")?.tier).toBe("monthly");
      });
    });
  });

  describe("getBackupsToPrune", () => {
    const defaultConfig: GFSConfig = {
      enabled: true,
      daily: 7,
      weekly: 4,
      monthly: 12,
    };

    it("should return all prunable backups", () => {
      // 10 backups, daily: 2, weekly: 1, monthly: 1
      const manifests: BackupManifest[] = [];
      for (let i = 0; i < 10; i++) {
        const date = new Date("2025-12-29T12:00:00Z");
        date.setDate(date.getDate() - i * 3);
        manifests.push(createManifest(`backup-${i}`, date.toISOString()));
      }

      const config: GFSConfig = { enabled: true, daily: 2, weekly: 1, monthly: 1 };
      const toPrune = getBackupsToPrune(manifests, config, 0);

      // Should return only prunable backups
      expect(toPrune.length).toBeGreaterThan(0);
      expect(toPrune.every((t) => t.tier === "prunable")).toBe(true);
    });

    it("should respect minKeep safety floor", () => {
      // 10 backups, all tiers = 0 (all prunable), but minKeep = 5
      const manifests: BackupManifest[] = [];
      for (let i = 0; i < 10; i++) {
        const date = new Date("2025-12-29T12:00:00Z");
        date.setDate(date.getDate() - i);
        manifests.push(createManifest(`backup-${i}`, date.toISOString()));
      }

      const config: GFSConfig = { enabled: true, daily: 0, weekly: 0, monthly: 0 };
      const toPrune = getBackupsToPrune(manifests, config, 5);

      // Should only prune 5 (10 - minKeep)
      expect(toPrune.length).toBe(5);
    });

    it("should not prune any backups when below minKeep", () => {
      const manifests = [
        createManifest("backup-1", "2025-12-29T12:00:00Z"),
        createManifest("backup-2", "2025-12-28T12:00:00Z"),
        createManifest("backup-3", "2025-12-27T12:00:00Z"),
      ];

      const config: GFSConfig = { enabled: true, daily: 0, weekly: 0, monthly: 0 };
      const toPrune = getBackupsToPrune(manifests, config, 5);

      // minKeep is 5, we only have 3, so nothing to prune
      expect(toPrune.length).toBe(0);
    });

    it("should return empty array when no backups are prunable", () => {
      const manifests = [
        createManifest("backup-1", "2025-12-29T12:00:00Z"),
        createManifest("backup-2", "2025-12-28T12:00:00Z"),
      ];

      const config: GFSConfig = { enabled: true, daily: 5, weekly: 4, monthly: 12 };
      const toPrune = getBackupsToPrune(manifests, config, 0);

      expect(toPrune.length).toBe(0);
    });

    it("should return empty array for empty input", () => {
      const toPrune = getBackupsToPrune([], defaultConfig, 0);
      expect(toPrune).toEqual([]);
    });

    it("should keep newest backups when minKeep applies", () => {
      // All backups are prunable, minKeep should keep the newest ones
      const manifests = [
        createManifest("old", "2025-12-20T12:00:00Z"),
        createManifest("newer", "2025-12-25T12:00:00Z"),
        createManifest("newest", "2025-12-29T12:00:00Z"),
      ];

      const config: GFSConfig = { enabled: true, daily: 0, weekly: 0, monthly: 0 };
      const toPrune = getBackupsToPrune(manifests, config, 2);

      // Should only prune 1 (oldest), keep 2 newest
      expect(toPrune.length).toBe(1);
      expect(toPrune[0].manifest.id).toBe("old");
    });
  });
});
