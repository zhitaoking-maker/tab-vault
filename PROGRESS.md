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
