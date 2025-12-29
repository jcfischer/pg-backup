/**
 * GFS (Grandfather-Father-Son) retention logic
 * Implements tiered backup retention with daily, weekly, and monthly tiers
 */

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
