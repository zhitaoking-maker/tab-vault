# Tab Vault

**A local-first Chrome tab workspace manager.**

Save a browser window as a workspace, close the original tabs, and restore the full workspace in one click. Tab Vault is built for people who regularly leave a dense research, planning, or browsing session and want to return to it without keeping every tab open.

No account. No cloud sync. Your workspace data stays in the browser profile where the extension is installed.

## Why Tab Vault

Most tab managers help you collect or search tabs. Tab Vault focuses on a different moment: you are done with a working session for now, want to clear the window, and still need a reliable way back later.

- Save the current window as an immutable workspace snapshot.
- Close the saved web tabs immediately, with a short undo window.
- Restore an entire workspace into a separate window without changing the current one.
- Restore only selected tabs, rename a workspace, pin it, or delete saved tabs you no longer need.
- Keep the dashboard local, searchable, and customizable with a background image and accent color.

## Install Locally

Tab Vault is currently distributed as an unpacked Chrome extension.

1. Clone or download this repository.

   ```bash
   git clone https://github.com/zhitaoking-maker/tab-vault.git
   ```

2. Open Chrome's extension menu, then select **Manage extensions**.

   ![Open Chrome extension management](docs/images/open-extensions.png)

3. Turn on **Developer mode**, click **Load unpacked**, and select the cloned `tab-vault` folder. Select the folder that contains `manifest.json`, not its parent directory.

   ![Load the unpacked extension](docs/images/load-unpacked.png)

4. Pin **Tab Vault** from Chrome's extension menu if you want one-click access from the toolbar.

## How It Works

1. Open the Tab Vault popup and select **Compress current window**.
2. The current HTTP/HTTPS tabs are saved locally, then closed. The dashboard opens in their place.
3. Use **Undo** within 10 seconds to restore the tabs to the original window.
4. From the dashboard, preview a workspace, restore all tabs in a new window, restore selected tabs, or remove selected saved tabs.

Workspaces remain in the timeline after restoration until you explicitly delete them.

## Privacy And Permissions

Tab Vault does not send workspace data anywhere.

| Permission | Why it is needed |
| --- | --- |
| `tabs` | Read tab URLs, titles, order, and pinned state; close saved tabs; create restored tabs. |
| `storage` | Save workspaces, the short undo record, and appearance preferences in the local browser profile. |
| `alarms` | Reliably expire the 10-second undo action when the dashboard is not active. |

The extension stores tab-level metadata only. It does not save page contents, cookies, login state, form input, scroll position, or browsing data outside its own local extension storage.

## Development

Requirements: Chrome desktop and a current Node.js runtime.

```bash
npm test
npm run test:coverage
```

The extension uses Manifest V3 and plain JavaScript. Load the project directory through `chrome://extensions` during development.

`npm run test:extension` is an optional smoke test for Chromium builds that permit headless unpacked-extension loading. Chrome release builds can reject that launch mode, so manual loading remains the end-to-end verification path.

## Roadmap

- Import and export local workspaces.
- Better bulk management for large timelines.
- Optional sync only if it can preserve the local-first privacy model.

## License

[MIT](LICENSE)

---

## 中文说明

Tab Vault 是一个本地优先的 Chrome 标签工作区管理扩展。它会将当前窗口保存为工作区快照、关闭原网页标签，并在需要时一键恢复。数据只保存在浏览器本地，不需要登录，也不会上传到云端。

