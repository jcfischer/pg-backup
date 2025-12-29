---
feature: "GFS Retention Schema"
spec: "./spec.md"
status: "draft"
---

# Technical Plan: GFS Retention Schema

## Architecture Overview

Add a GFS tier classification layer between backup manifests and prune logic. The tier classifier is a pure function that takes manifests and GFS config, returning classified backups. This keeps the algorithm testable and deterministic.

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLI Layer                                │
│  (prune command, list command)                                  │
└─────────────────┬───────────────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────────────┐
│                    GFS Retention Module                          │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────────────┐ │
│  │  GFSConfig  │  │ Tier        │  │ classifyBackups()        │ │
│  │  (types)    │──▶ Classifier  │──▶ Returns TieredBackup[]   │ │
│  └─────────────┘  └─────────────┘  └──────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────────────┐
│                   Existing Prune Logic                           │
│  (prune.ts - minimally modified)                                │
└─────────────────────────────────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────────────┐
│                   Manifest Storage                               │
│  (manifest.ts - unchanged)                                       │
└─────────────────────────────────────────────────────────────────┘
```

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | TypeScript | Existing codebase |
| Runtime | Bun | Existing codebase |
| Date handling | Native Date + UTC | ISO 8601 week calc, no dependencies |
| Testing | bun:test | Existing test framework |

**No new dependencies required.** ISO week calculation is simple enough to implement directly.

## Constitutional Compliance

- [x] **CLI-First:** Extends existing prune/list CLI commands with GFS support
- [x] **Library-First:** Core `classifyBackups()` function is a pure, reusable module
- [x] **Test-First:** TDD with tier classification unit tests before implementation
- [x] **Deterministic:** Pure function with UTC timestamps ensures reproducible results
- [x] **Code Before Prompts:** All logic in TypeScript, no AI/prompts involved

## Data Model

### New Types (src/types.ts)

```typescript
export type BackupTier = "daily" | "weekly" | "monthly" | "prunable";

export interface GFSConfig {
  enabled: boolean;
  daily: number;   // default: 7
  weekly: number;  // default: 4
  monthly: number; // default: 12
}

export interface TieredBackup {
  manifest: BackupManifest;
  tier: BackupTier;
  tierReason: string;  // e.g., "newest 7", "week 2024-W52", "month 2024-12"
}

// Extended RetentionConfig (backward compatible)
export interface RetentionConfig {
  days: number;
  minKeep: number;
  gfs?: GFSConfig;  // Optional - when undefined, use legacy behavior
}
```

### No Database Changes

All data stored in existing manifest.json files. Tier classification is computed at runtime, not persisted.

## API Contracts

### Internal APIs

```typescript
// src/gfs.ts - Core classification logic

/**
 * Get ISO 8601 week number for a date (UTC)
 * Week 1 contains first Thursday of year, weeks start Monday
 */
export function getISOWeek(date: Date): { year: number; week: number };

/**
 * Get year-month key for grouping (UTC)
 */
export function getMonthKey(date: Date): string;  // "2024-12"

/**
 * Classify backups into GFS tiers
 * Pure function - same inputs always produce same outputs
 */
export function classifyBackups(
  manifests: BackupManifest[],
  config: GFSConfig
): TieredBackup[];

/**
 * Get backups to prune based on GFS classification
 */
export function getBackupsToPrune(
  manifests: BackupManifest[],
  config: GFSConfig,
  minKeep: number
): { keep: TieredBackup[]; prune: TieredBackup[] };
```

## Implementation Strategy

### Phase 1: Foundation (Types + Date Utilities)

Build the type definitions and ISO week calculation with comprehensive tests.

- [ ] Add `BackupTier`, `GFSConfig`, `TieredBackup` types to `types.ts`
- [ ] Extend `RetentionConfig` with optional `gfs` field
- [ ] Create `src/gfs.ts` with `getISOWeek()` function
- [ ] Create `src/gfs.ts` with `getMonthKey()` function
- [ ] Tests for ISO week edge cases (year boundaries, week 53)

### Phase 2: Core Classification

Implement the tier classification algorithm with full test coverage.

- [ ] Implement `classifyBackups()` function
- [ ] Implement `getBackupsToPrune()` function
- [ ] Tests for daily tier assignment
- [ ] Tests for weekly tier promotion (oldest in week)
- [ ] Tests for monthly tier promotion (oldest in month)
- [ ] Tests for tier priority (monthly > weekly > daily)
- [ ] Tests for prunable classification

### Phase 3: Configuration Integration

Wire GFS config into existing configuration system.

- [ ] Add GFS environment variables to `config.ts`
- [ ] Add GFS config validation
- [ ] Tests for config loading with GFS enabled/disabled
- [ ] Tests for backward compatibility (GFS disabled by default)

### Phase 4: CLI Integration

Update CLI commands to use GFS when enabled.

- [ ] Update `prune` command to use GFS classification when enabled
- [ ] Update `list` command to show tier column when GFS enabled
- [ ] Add tier summary output ("7 daily, 4 weekly, 12 monthly")
- [ ] Update dry-run output to show tier for each backup
- [ ] CLI integration tests

### Phase 5: Documentation

Update CLAUDE.md and help text.

- [ ] Update CLAUDE.md with GFS configuration examples
- [ ] Update CLI help text for prune command
- [ ] Add GFS section to configuration docs

## File Structure

```
src/
├── types.ts           # [Modified] Add GFSConfig, BackupTier, TieredBackup
├── config.ts          # [Modified] Add GFS env var loading
├── gfs.ts             # [New] GFS classification logic
├── prune.ts           # [Modified] Use GFS when enabled
└── cli.ts             # [Modified] Update list/prune output

tests/
├── gfs.test.ts        # [New] GFS classification tests
├── config.test.ts     # [Modified] Add GFS config tests
├── prune.test.ts      # [Modified] Add GFS prune tests
└── cli.test.ts        # [Modified] Add GFS CLI tests
```

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| ISO week edge cases | Medium | Medium | Comprehensive tests for week 52/53, year transitions |
| Breaking existing retention | High | Low | GFS is opt-in, default behavior unchanged |
| Timezone inconsistency | Medium | Low | All calculations use UTC explicitly |
| Prune deletes wrong backups | High | Low | minKeep safety floor + dry-run testing |

## Dependencies

### External

None - ISO week calculation implemented directly.

### Internal

- `manifest.ts` - `listManifests()` for reading backups (unchanged)
- `types.ts` - Type definitions (extended)
- `config.ts` - Configuration loading (extended)

## Migration/Deployment

- [ ] **Database migrations needed?** No
- [ ] **Environment variables?** Yes - 4 new optional env vars
- [ ] **Breaking changes?** No - fully backward compatible

### New Environment Variables

```bash
PG_BACKUP_GFS_ENABLED=true     # Enable GFS mode (default: false)
PG_BACKUP_GFS_DAILY=7          # Daily backups to keep (default: 7)
PG_BACKUP_GFS_WEEKLY=4         # Weekly backups to keep (default: 4)
PG_BACKUP_GFS_MONTHLY=12       # Monthly backups to keep (default: 12)
```

### Upgrade Path

1. Deploy new version
2. Optionally enable GFS via `PG_BACKUP_GFS_ENABLED=true`
3. Run `pg-backup prune --dry-run` to verify expected behavior
4. Run `pg-backup prune` to apply new retention policy

## Estimated Complexity

- **New files:** 1 (gfs.ts)
- **Modified files:** 4 (types.ts, config.ts, prune.ts, cli.ts)
- **New test files:** 1 (gfs.test.ts)
- **Modified test files:** 3 (config.test.ts, prune.test.ts, cli.test.ts)
- **Estimated tasks:** ~15-18 discrete implementation tasks
