# Changelog

All notable changes to Tab Vault are documented here.

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
