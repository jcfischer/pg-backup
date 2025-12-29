---
feature: "GFS Retention Schema"
plan: "./plan.md"
status: "pending"
total_tasks: 16
completed: 0
---

# Tasks: GFS Retention Schema

## Legend

- `[T]` - Test required (TDD mandatory - write test FIRST)
- `[P]` - Can run in parallel with other [P] tasks in same group
- `depends: T-X.Y` - Must complete after specified task(s)

## Task Groups

### Group 1: Foundation (Types & Date Utilities)

- [ ] **T-1.1** Add GFS type definitions [T] [P]
  - File: `src/types.ts`
  - Test: `tests/types.test.ts` (extend existing)
  - Description: Add `BackupTier`, `GFSConfig`, `TieredBackup` types. Extend `RetentionConfig` with optional `gfs` field.

- [ ] **T-1.2** Implement ISO week calculation [T] [P]
  - File: `src/gfs.ts`
  - Test: `tests/gfs.test.ts`
  - Description: Create `getISOWeek(date: Date)` returning `{ year, week }`. Handle week 52/53, year boundaries. All UTC.

- [ ] **T-1.3** Implement month key extraction [T] [P]
  - File: `src/gfs.ts`
  - Test: `tests/gfs.test.ts`
  - Description: Create `getMonthKey(date: Date)` returning "YYYY-MM" string. UTC only.

### Group 2: Core Classification Algorithm

- [ ] **T-2.1** Implement daily tier assignment [T] (depends: T-1.1, T-1.2, T-1.3)
  - File: `src/gfs.ts`
  - Test: `tests/gfs.test.ts`
  - Description: First pass of `classifyBackups()` - assign newest N backups as "daily" tier.

- [ ] **T-2.2** Implement weekly tier promotion [T] (depends: T-2.1)
  - File: `src/gfs.ts`
  - Test: `tests/gfs.test.ts`
  - Description: Group remaining backups by ISO week. Promote oldest in each week to "weekly" tier.

- [ ] **T-2.3** Implement monthly tier promotion [T] (depends: T-2.2)
  - File: `src/gfs.ts`
  - Test: `tests/gfs.test.ts`
  - Description: Group remaining backups by month. Promote oldest in each month to "monthly" tier.

- [ ] **T-2.4** Implement tier priority rules [T] (depends: T-2.3)
  - File: `src/gfs.ts`
  - Test: `tests/gfs.test.ts`
  - Description: Ensure monthly > weekly > daily priority. A backup belongs to highest tier only.

- [ ] **T-2.5** Implement prunable classification [T] (depends: T-2.4)
  - File: `src/gfs.ts`
  - Test: `tests/gfs.test.ts`
  - Description: Mark all unclassified backups as "prunable". Complete `classifyBackups()` function.

- [ ] **T-2.6** Implement getBackupsToPrune helper [T] (depends: T-2.5)
  - File: `src/gfs.ts`
  - Test: `tests/gfs.test.ts`
  - Description: Create `getBackupsToPrune()` that respects `minKeep` safety floor across all tiers.

### Group 3: Configuration Integration

- [ ] **T-3.1** Add GFS environment variables [T] (depends: T-1.1)
  - File: `src/config.ts`
  - Test: `tests/config.test.ts`
  - Description: Add `PG_BACKUP_GFS_ENABLED`, `GFS_DAILY`, `GFS_WEEKLY`, `GFS_MONTHLY` loading.

- [ ] **T-3.2** Add GFS config validation [T] (depends: T-3.1)
  - File: `src/config.ts`
  - Test: `tests/config.test.ts`
  - Description: Validate GFS values are positive integers. Error on invalid config.

- [ ] **T-3.3** Verify backward compatibility [T] (depends: T-3.2)
  - File: `src/config.ts`
  - Test: `tests/config.test.ts`
  - Description: Ensure default `gfs.enabled = false`. Existing configs work unchanged.

### Group 4: CLI Integration

- [ ] **T-4.1** Update prune command for GFS [T] (depends: T-2.6, T-3.3)
  - File: `src/cli.ts`
  - Test: `tests/cli.test.ts`
  - Description: When GFS enabled, use `getBackupsToPrune()` instead of age-based logic.

- [ ] **T-4.2** Update list command for GFS [T] (depends: T-2.6, T-3.3)
  - File: `src/cli.ts`
  - Test: `tests/cli.test.ts`
  - Description: Show tier column when GFS enabled. Add tier summary line.

- [ ] **T-4.3** Update prune dry-run output [T] (depends: T-4.1)
  - File: `src/cli.ts`
  - Test: `tests/cli.test.ts`
  - Description: Show tier classification for each backup in dry-run mode.

### Group 5: Documentation

- [ ] **T-5.1** Update CLAUDE.md (depends: T-4.3)
  - File: `CLAUDE.md`
  - Description: Add GFS configuration section with examples. Document env vars.

## Dependency Graph

```
T-1.1 ──────────────────────────┬──> T-3.1 ──> T-3.2 ──> T-3.3 ──┐
                                │                                 │
T-1.2 ──┬──> T-2.1 ──> T-2.2 ──> T-2.3 ──> T-2.4 ──> T-2.5 ──> T-2.6 ──┬──> T-4.1 ──> T-4.3 ──> T-5.1
        │                                                              │
T-1.3 ──┘                                                              └──> T-4.2
```

## Execution Order

1. **Parallel batch 1:** T-1.1, T-1.2, T-1.3 (Foundation - independent)
2. **Sequential:** T-2.1 → T-2.2 → T-2.3 → T-2.4 → T-2.5 → T-2.6 (Core algorithm chain)
3. **Parallel with Group 2:** T-3.1 → T-3.2 → T-3.3 (Config - only needs T-1.1)
4. **After Groups 2+3:** T-4.1, T-4.2 (CLI - can parallelize)
5. **Sequential:** T-4.3 (after T-4.1)
6. **Final:** T-5.1 (Documentation)

**Critical path:** T-1.2 → T-2.1 → T-2.2 → T-2.3 → T-2.4 → T-2.5 → T-2.6 → T-4.1 → T-4.3 → T-5.1

## Progress Tracking

| Task | Status | Started | Completed | Notes |
|------|--------|---------|-----------|-------|
| T-1.1 | pending | - | - | Types definition |
| T-1.2 | pending | - | - | ISO week calc |
| T-1.3 | pending | - | - | Month key |
| T-2.1 | pending | - | - | Daily tier |
| T-2.2 | pending | - | - | Weekly promotion |
| T-2.3 | pending | - | - | Monthly promotion |
| T-2.4 | pending | - | - | Tier priority |
| T-2.5 | pending | - | - | Prunable marking |
| T-2.6 | pending | - | - | Prune helper |
| T-3.1 | pending | - | - | Env vars |
| T-3.2 | pending | - | - | Validation |
| T-3.3 | pending | - | - | Backward compat |
| T-4.1 | pending | - | - | Prune command |
| T-4.2 | pending | - | - | List command |
| T-4.3 | pending | - | - | Dry-run output |
| T-5.1 | pending | - | - | Docs |

## TDD Reminder

For each task marked [T]:

1. **RED:** Write failing test first
2. **GREEN:** Write minimal implementation to pass
3. **BLUE:** Refactor while keeping tests green
4. **VERIFY:** Run full test suite (`bun test --randomize`)

**DO NOT proceed to next task until:**
- Current task's tests pass
- Full test suite passes (no regressions)

## Blockers & Issues

[Track any blockers discovered during implementation]

| Task | Issue | Resolution |
|------|-------|------------|
| - | - | - |
