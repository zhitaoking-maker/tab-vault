# Changelog

All notable changes to Tab Vault are documented here.

## [0.5.0] - 2026-09-10

### Added

- Workspace archiving workflow: mark inactive workspaces as archived and browse/restore them from a collapsible drawer, solving the infinite timeline issue.
- Prompt Vault core and dashboard board: category filtering, real-time keyword search, creation/editing, and standalone versioned JSON export/import.
- One-click text copying with lightweight toast visual feedback across both Dashboard and Popup views.
- Seamless hash routing (`#prompts`) allowing direct navigation from popup to prompt board.
- Dual-view compact popup supporting quick prompt search and copy alongside active workspace restoration.

### Changed

- Cleaned all colorful emoji icons from navigation tabs, returning to pure minimalist typographic hierarchy.
- Decoupled appearance panel and synchronized header drawer panels (backup/trash) with prompt view state.
- Upgraded version baseline to 0.5.0 with full automated test suite coverage (107 tests passing).

## [0.4.0] - 2026-07-27

### Added

- A configurable `Alt + Shift + V` command for compressing the last focused ordinary window.
- Current Chrome tab-group compression without closing unrelated tabs in the same window.
- Atomic save-all for ordinary non-incognito windows, with one dashboard landing tab and multi-window undo.
- Readable title-and-URL lists as the primary copy action, with plain URL and Markdown formats in a compact menu.
- Browser-level coverage for the new popup actions and clipboard workflow.

### Changed

- The popup keeps current-window compression as the primary action and presents group/all-window saves as compact secondary actions.
- Combined multi-window snapshots are verified in local storage before any source webpage is closed.

## [0.3.0] - 2026-07-27

### Added

- Chrome native tab-group snapshots, including group title, color, collapsed state, and membership.
- Live restore progress for tabs and tab groups, with retryable failed tabs returning to their original restored group.
- Batch pin and unpin actions for selected workspaces.
- Bounded dashboard rendering with 40 workspaces per page and an explicit load-more control.
- A browser-level dashboard test covering desktop behavior and the 390px layout.

### Changed

- Local data and portable backup schemas now use version 2 while remaining able to import v0.2 schema-version-1 backups.
- Workspace previews now show native tab-group badges and group counts.
- Restore results now report incomplete tab-group metadata separately.

## [0.2.0] - 2026-07-26

### Added

- Versioned `.tabvault.json` export, import preview, and non-destructive import merging.
- A 30-day recycle bin for deleted workspaces, including batch deletion and permanent cleanup.
- Per-tab restore failure isolation with retry support from the dashboard.
- Local storage usage reporting and an 80% capacity warning.
- Versioned local data that remains compatible with v0.1.0 workspace records.

### Changed

- Workspace snapshots are verified in local storage before source tabs are closed.
- Restore results now distinguish failed, unsupported, and pin-state failures.

## [0.1.0] - 2026-07-24

### Added

- Local workspace snapshots for Chrome tab windows.
- One-click full restore and selected-tab restore in a separate window.
- Short undo window after compression.
- Workspace rename, pin, search, preview, and selected-tab deletion.
- Local dashboard background and accent-color customization.

### Notes

- Workspace data stays in Chrome extension local storage.
- Internal Chrome pages and other unsupported URLs are retained in previews but are not restored.
