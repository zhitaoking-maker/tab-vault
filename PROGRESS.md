# Tab-Vault Data Core Progress

- Goal: add local prompt data primitives and archive-compatible workspace status.
- Step 0 complete: baseline `npm test` is 93/93 passing with zero failures or skips.
- Step 1: add workspace status normalization plus archive and unarchive operations.
- Step 1 complete: targeted workspace-query suite passed 4/4; legacy records normalize to active.
- Step 2: add an independent, versioned prompt data core with import/export.
- Step 2 complete: prompt-core targeted suite passed 5/5 with no external dependencies.
- Import contract narrowed to the required merge mode; omitted unspecified replace semantics to prevent accidental local overwrites.
- Step 3: cover all new pure functions, prove a deliberately reversed assertion fails, then restore it.
- Step 3 complete: 7 new tests added; reversed archive assertion failed 3/4, then restored and passed 4/4.
- Final gate: full suite must be at least 100 passing tests; only allowlisted files may differ.
- Final gate complete: full `npm test` passed 100/100 with zero fail, cancelled, skipped, or todo tests.
- Maximum risk: undefined prompt-import shape could create an incompatible storage contract; use explicit version and failure results.

## Phase 2 Dashboard Archive Drawer and Prompt Board

- Step 0 complete: on `feature/v0.5.0-prompt-vault` with a clean worktree; baseline `npm test` passed 100/100.
- Scope: add Dashboard-only archive controls and a local prompt board using existing `prompt-core.js`, without touching workspace backups.
- Implementation order: inspect the Dashboard render/event model, add UI markup and styles, connect data flow, then add focused tests and commit.
- Maximum risk: Dashboard has several legacy delegated actions; new controls must coexist without changing backup or restore message flows.
- Step 1 and 2 implemented: active-only timeline, collapsed archive drawer, and independent prompt board data flow are wired into Dashboard.
- Browser regression complete: `npm run test:dashboard` passed after normalizing legacy status records at the Dashboard boundary.
- Step 3 complete: added `dashboard-prompt-view.test.js`; full `npm test` passed 103/103 with zero fail, cancelled, skipped, or todo tests.
- Ready for commit: only the Phase 2 whitelist files are changed; no deferred decisions require BLOCKED.md.

## Phase 3 Popup Prompt Quick Copy

- Step 0 complete: on `feature/v0.5.0-prompt-vault` with a clean worktree; baseline `npm test` passed 103/103.
- Scope: add a compact Popup workspace/prompt switcher, active-only workspace list, and prompt search with one-click copy.
- Implementation order: preserve existing save actions, add view markup and compact styles, connect local prompt reads, then test and commit.
- Maximum risk: Popup action handlers must remain available in the workspace view without inheriting Dashboard management complexity.
- Step 1 and 2 implemented: Popup tabs preserve the save workflow, hide archived sessions, and add prompt-only search, copy, and Dashboard handoff.
- Step 3 complete: added `popup-prompt-view.test.js`; full `npm test` passed 105/105 and browser regression passed with zero deferred decisions.
- Ready for commit: only the Phase 3 whitelist files are changed; no BLOCKED.md is required.

## Dashboard Hash and Header Sync Fix

- Baseline complete: `npm test` passed 105/105 on the phase branch with a clean worktree.
- Implemented: Hash-driven Dashboard view selection, Header copy synchronization, and public appearance controls.
- Implemented: backup and trash actions now return from prompts to workspaces before opening their panels.
- Verification complete: focused Dashboard tests passed 5/5, full `npm test` passed 107/107, and `npm run test:dashboard` passed.
- Ready for commit: only the repair whitelist files changed; no BLOCKED.md is required.

## Dashboard Text Tab Cleanup

- Baseline complete: `npm test` passed 107/107 on the existing hash-routing fix.
- Implemented: Dashboard navigation tabs are pure text; prompt-view Header now uses the concise 「提示词」 label.
- Retained: existing Hash routing, Header panel synchronization, and compliant muted/accent 2px tab indicator styling without unrelated CSS churn.
- Verification complete: Dashboard-focused tests passed 5/5, full `npm test` passed 107/107, and browser regression passed.
- Ready for commit: only the cleanup whitelist files changed; no BLOCKED.md is required.
