---
id: "043"
feature: "GFS Retention Schema"
status: "draft"
created: "2025-12-29"
---

# Specification: GFS Retention Schema

## Overview

Implement Grandfather-Father-Son (GFS) backup retention to provide long-term backup history with diminishing granularity. This replaces the current simple age-based retention with a tiered approach that keeps daily backups for recent history, weekly backups for medium-term, and monthly backups for long-term archival.

**Why it matters:** Current linear retention (30 days) forces a trade-off between storage cost and historical recovery options. GFS allows keeping 12+ months of recovery points while using less storage than keeping 30 daily backups.

## User Scenarios

### Scenario 1: Configure GFS Retention Policy

**As a** system administrator
**I want to** configure separate retention periods for daily, weekly, and monthly backups
**So that** I can balance storage costs against recovery point availability

**Acceptance Criteria:**
- [ ] Can set number of daily backups to retain (default: 7)
- [ ] Can set number of weekly backups to retain (default: 4)
- [ ] Can set number of monthly backups to retain (default: 12)
- [ ] Configuration via environment variables follows existing pattern
- [ ] Invalid configurations are rejected with clear error messages

### Scenario 2: Automatic Tier Classification

**As a** system administrator
**I want** backups to be automatically classified into daily/weekly/monthly tiers
**So that** I don't need to manually manage which backups to keep

**Acceptance Criteria:**
- [ ] Most recent N backups are classified as "daily" tier
- [ ] One backup per week (oldest in that week) is promoted to "weekly" tier
- [ ] One backup per month (oldest in that month) is promoted to "monthly" tier
- [ ] A backup can only belong to one tier (highest tier wins)
- [ ] Classification is deterministic given the same set of backups

### Scenario 3: Pruning with GFS Policy

**As a** system administrator
**I want** the prune command to respect GFS tier classifications
**So that** I retain the correct historical recovery points

**Acceptance Criteria:**
- [ ] Daily backups beyond retention count are pruned (unless promoted)
- [ ] Weekly backups beyond retention count are pruned (unless promoted)
- [ ] Monthly backups beyond retention count are pruned
- [ ] Prune dry-run shows tier classification for each backup
- [ ] Minimum safety floor still applies (never prune below minKeep)

### Scenario 4: View Backup Tiers

**As a** system administrator
**I want to** see which tier each backup belongs to
**So that** I understand what will be retained long-term

**Acceptance Criteria:**
- [ ] `pg-backup list` shows tier classification for each backup
- [ ] Tier is displayed as: daily, weekly, monthly, or (prunable)
- [ ] Summary shows count per tier

### Scenario 5: Backward Compatibility

**As an** existing user
**I want** the tool to work without configuration changes
**So that** my current setup continues to function

**Acceptance Criteria:**
- [ ] Default behavior matches current retention if GFS not explicitly enabled
- [ ] Existing `PG_BACKUP_RETENTION_DAYS` and `PG_BACKUP_RETENTION_MIN_KEEP` still work
- [ ] GFS mode is opt-in via explicit configuration

## Functional Requirements

### FR-1: GFS Configuration

The system must accept GFS retention configuration via environment variables:
- `PG_BACKUP_GFS_ENABLED`: boolean to enable GFS mode (default: false)
- `PG_BACKUP_GFS_DAILY`: number of daily backups to keep (default: 7)
- `PG_BACKUP_GFS_WEEKLY`: number of weekly backups to keep (default: 4)
- `PG_BACKUP_GFS_MONTHLY`: number of monthly backups to keep (default: 12)

**Validation:** Unit tests verify configuration parsing and defaults

### FR-2: Tier Classification Algorithm

The system must classify backups into tiers using this algorithm:
1. Sort all backups by timestamp (newest first)
2. Mark the newest N backups as "daily" (N = daily retention count)
3. Group remaining backups by ISO week; mark the oldest backup in each week as "weekly"
4. Group remaining backups by month; mark the oldest backup in each month as "monthly"
5. All unclassified backups are "prunable"

**Validation:** Unit tests with various backup distributions verify correct classification

### FR-3: Week Boundary Definition

The system must use ISO 8601 week definition:
- Week starts on Monday
- Week 1 is the week containing the first Thursday of the year

**Validation:** Unit tests verify week boundary edge cases (year transitions)

### FR-4: Month Boundary Definition

The system must use calendar month boundaries:
- Month is determined by the backup timestamp's month
- Timezone is UTC for consistency

**Validation:** Unit tests verify month boundary edge cases

### FR-5: Tier Promotion Rules

When a backup qualifies for multiple tiers, the highest tier wins:
- Monthly > Weekly > Daily

A monthly backup is never also counted as weekly or daily.

**Validation:** Unit tests verify promotion logic

### FR-6: GFS Prune Operation

The prune operation must:
1. Classify all backups into tiers
2. For each tier, keep only the configured retention count
3. Delete backups marked as "prunable"
4. Respect minKeep safety floor across all tiers combined

**Validation:** Integration tests verify correct pruning behavior

### FR-7: List Command Enhancement

The `list` command must show:
- Tier classification for each backup (when GFS enabled)
- Summary counts: "7 daily, 4 weekly, 12 monthly, 3 prunable"

**Validation:** Manual testing and snapshot tests

## Non-Functional Requirements

- **Performance:** Tier classification must complete in O(n) time where n = number of backups
- **Consistency:** Classification must be deterministic (same input = same output)
- **Observability:** Prune operations must log tier decisions for debugging

## Key Entities

| Entity | Description | Key Attributes |
|--------|-------------|----------------|
| BackupTier | Classification level | `daily`, `weekly`, `monthly`, `prunable` |
| GFSConfig | Retention configuration | `enabled`, `daily`, `weekly`, `monthly` |
| TieredBackup | Backup with tier info | `manifest`, `tier`, `tierReason` |

## Success Criteria

- [ ] All existing tests pass (no regression)
- [ ] New tests cover GFS classification algorithm with 100% branch coverage
- [ ] Default configuration (GFS disabled) produces identical behavior to current
- [ ] Documentation updated with GFS configuration examples
- [ ] `pg-backup prune --dry-run` clearly shows tier classification

## Assumptions

- Backups have accurate timestamps in their manifests
- One backup per day maximum (multiple daily backups = only newest counts as "daily")
- UTC timezone for all date calculations
- ISO 8601 week numbering is acceptable for all users

## [NEEDS CLARIFICATION]

- [ ] **Week start day:** Should week start be configurable (Monday vs Sunday)?
  -> weeks start on Monday
- [ ] **Timezone:** Should timezone be configurable or always UTC?
  -> yse UTC
- [ ] **Promotion strategy:** "Oldest in period" vs "newest in period" for weekly/monthly selection?
  -> oldest in period

## Out of Scope

- Separate retention policies per backup type (DB vs directories)
- Custom retention schedules (e.g., "keep every 3rd day")
- Off-site sync tier awareness (all tiers synced equally)
- Backup tagging or manual tier override
