/**
 * GFS (Grandfather-Father-Son) retention logic
 * Implements tiered backup retention with daily, weekly, and monthly tiers
 */

import type { BackupManifest, GFSConfig, TieredBackup } from "./types";

/**
 * Get ISO 8601 week number for a date (UTC)
 * Week 1 contains first Thursday of year, weeks start Monday
 *
 * @param date - The date to get the ISO week for
 * @returns Object with year and week number
 */
export function getISOWeek(date: Date): { year: number; week: number } {
  // Create a copy in UTC
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );

  // Set to nearest Thursday: current date + 4 - current day number
  // Make Sunday's day number 7 (ISO week starts Monday)
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);

  // Get first day of year
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));

  // Calculate week number
  const weekNum = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
  );

  return {
    year: d.getUTCFullYear(),
    week: weekNum,
  };
}

/**
 * Get year-month key for grouping (UTC)
 *
 * @param date - The date to get the month key for
 * @returns String in format "YYYY-MM"
 */
export function getMonthKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * Classify backups into GFS tiers
 * Pure function - same inputs always produce same outputs
 *
 * Algorithm:
 * 1. Sort all backups by timestamp (newest first)
 * 2. Mark the newest N backups as "daily" (N = daily retention count)
 * 3. Group remaining backups by ISO week; mark oldest in each week as "weekly"
 * 4. Group remaining backups by month; mark oldest in each month as "monthly"
 * 5. All unclassified backups are "prunable"
 *
 * @param manifests - Array of backup manifests to classify
 * @param config - GFS configuration
 * @returns Array of TieredBackup with tier assignments
 */
export function classifyBackups(
  manifests: BackupManifest[],
  config: GFSConfig
): TieredBackup[] {
  if (manifests.length === 0) {
    return [];
  }

  // Sort by timestamp, newest first
  const sorted = [...manifests].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  const result: TieredBackup[] = [];
  const assigned = new Set<string>(); // Track which manifests are assigned

  // Phase 1: Assign daily tier to newest N backups
  for (let i = 0; i < Math.min(config.daily, sorted.length); i++) {
    const manifest = sorted[i];
    result.push({
      manifest,
      tier: "daily",
      tierReason: `newest ${config.daily}`,
    });
    assigned.add(manifest.id);
  }

  // Phase 2: Assign weekly tier to oldest backup in each week (up to weekly limit)
  // Get remaining (non-daily) backups, sorted oldest first for weekly selection
  const remaining = sorted.filter((m) => !assigned.has(m.id));
  const weekGroups = new Map<string, BackupManifest[]>();

  for (const manifest of remaining) {
    const date = new Date(manifest.timestamp);
    const { year, week } = getISOWeek(date);
    const weekKey = `${year}-W${week.toString().padStart(2, "0")}`;

    if (!weekGroups.has(weekKey)) {
      weekGroups.set(weekKey, []);
    }
    weekGroups.get(weekKey)!.push(manifest);
  }

  // For each week, find the oldest backup (candidate for weekly promotion)
  const weeklyCandidate: Array<{ weekKey: string; manifest: BackupManifest }> = [];
  for (const [weekKey, backups] of weekGroups) {
    // Sort by timestamp ascending (oldest first)
    const sortedByTime = [...backups].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    weeklyCandidate.push({ weekKey, manifest: sortedByTime[0] });
  }

  // Sort weekly candidates by week (newest weeks first for retention priority)
  weeklyCandidate.sort((a, b) => b.weekKey.localeCompare(a.weekKey));

  // Assign weekly tier up to the limit
  let weeklyAssigned = 0;
  for (const { weekKey, manifest } of weeklyCandidate) {
    if (weeklyAssigned >= config.weekly) break;

    result.push({
      manifest,
      tier: "weekly",
      tierReason: `week ${weekKey}`,
    });
    assigned.add(manifest.id);
    weeklyAssigned++;
  }

  // Phase 3: Assign monthly tier to oldest backup in each month (up to monthly limit)
  // Get remaining (non-daily, non-weekly) backups
  const remainingForMonthly = sorted.filter((m) => !assigned.has(m.id));
  const monthGroups = new Map<string, BackupManifest[]>();

  for (const manifest of remainingForMonthly) {
    const date = new Date(manifest.timestamp);
    const monthKey = getMonthKey(date);

    if (!monthGroups.has(monthKey)) {
      monthGroups.set(monthKey, []);
    }
    monthGroups.get(monthKey)!.push(manifest);
  }

  // For each month, find the oldest backup (candidate for monthly promotion)
  const monthlyCandidates: Array<{ monthKey: string; manifest: BackupManifest }> = [];
  for (const [monthKey, backups] of monthGroups) {
    // Sort by timestamp ascending (oldest first)
    const sortedByTime = [...backups].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    monthlyCandidates.push({ monthKey, manifest: sortedByTime[0] });
  }

  // Sort monthly candidates by month (newest months first for retention priority)
  monthlyCandidates.sort((a, b) => b.monthKey.localeCompare(a.monthKey));

  // Assign monthly tier up to the limit
  let monthlyAssigned = 0;
  for (const { monthKey, manifest } of monthlyCandidates) {
    if (monthlyAssigned >= config.monthly) break;

    result.push({
      manifest,
      tier: "monthly",
      tierReason: `month ${monthKey}`,
    });
    assigned.add(manifest.id);
    monthlyAssigned++;
  }

  // Phase 4: Remaining backups are prunable
  for (const manifest of sorted) {
    if (!assigned.has(manifest.id)) {
      result.push({
        manifest,
        tier: "prunable",
        tierReason: "exceeds retention",
      });
    }
  }

  // Sort result to match original sort order (newest first)
  result.sort(
    (a, b) =>
      new Date(b.manifest.timestamp).getTime() -
      new Date(a.manifest.timestamp).getTime()
  );

  return result;
}

/**
 * Get backups that should be pruned, respecting minKeep safety floor
 *
 * @param manifests - Array of backup manifests
 * @param config - GFS configuration
 * @param minKeep - Minimum number of backups to always keep
 * @returns Array of TieredBackup that should be pruned
 */
export function getBackupsToPrune(
  manifests: BackupManifest[],
  config: GFSConfig,
  minKeep: number
): TieredBackup[] {
  if (manifests.length === 0) {
    return [];
  }

  // Get classification for all backups
  const classified = classifyBackups(manifests, config);

  // Get prunable backups
  const prunable = classified.filter((t) => t.tier === "prunable");

  // Get non-prunable count
  const keepCount = classified.filter((t) => t.tier !== "prunable").length;

  // Respect minKeep safety floor
  // If we'd go below minKeep total, limit how many we prune
  const totalBackups = manifests.length;
  const maxToPrune = Math.max(0, totalBackups - minKeep);

  // Prunable backups are already sorted newest first (from classifyBackups)
  // We want to prune oldest first, so reverse the order for limiting
  const prunableOldestFirst = [...prunable].sort(
    (a, b) =>
      new Date(a.manifest.timestamp).getTime() -
      new Date(b.manifest.timestamp).getTime()
  );

  // Limit to maxToPrune
  return prunableOldestFirst.slice(0, maxToPrune);
}
