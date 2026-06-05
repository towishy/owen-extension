# Owen Browser Bridge

Owen Browser Bridge is a two-part local bridge that lets GitHub Copilot in VS Code analyze browser data captured from Chrome or Edge.

```text
Chrome / Edge extension
	-> localhost HTTP bridge in this VS Code extension
	-> workspace capture files + VS Code Language Model Tools
	-> GitHub Copilot Chat analysis
```

The initial target is Defender, Entra, Azure portal, and similar security investigation pages where the browser has context that Copilot cannot otherwise inspect directly.

## What It Captures

- Current tab URL and title
- Visible page text
- Selected text
- Page headings, visible buttons/links, viewport data, and meta tags
- Optional HTML snapshot
- Optional visible-tab PNG screenshot

Captures are saved under `raw/browser-captures/<host>/<group>/` by default as JSON, Markdown, and PNG files. Each group also gets `_index.json` and `_summary.md` so Copilot can analyze related multi-page investigations together. That folder is ignored by git.

## Install From GitHub

Use these steps when installing Owen Browser Bridge on another Windows PC or on macOS.

### Option A. Install both extensions from a GitHub Release

1. Open <https://github.com/towishy/owen-extension/releases>.
2. Download both release assets:
	- `owen-browser-bridge-*.vsix`
	- `owen-browser-capture-browser-extension-*.zip`
3. In VS Code, press `Ctrl+Shift+P` on Windows/Linux or `Cmd+Shift+P` on macOS.
4. Run `Extensions: Install from VSIX...`.
5. Select the downloaded `.vsix` file.
6. Extract `owen-browser-capture-browser-extension-*.zip` to a local folder.
7. Load the extracted folder as an unpacked Chrome/Edge extension.
8. Run `Developer: Reload Window` if the `Owen Browser Bridge` commands do not appear immediately.

### Option B. Build and install from the GitHub repository

Windows PowerShell:

```powershell
git clone https://github.com/towishy/owen-extension.git C:\OWEN\github\owen-extension
Set-Location C:\OWEN\github\owen-extension
npm install
npm run package
code --install-extension .\owen-browser-bridge-0.1.5.vsix --force
```

macOS terminal:

```bash
git clone https://github.com/towishy/owen-extension.git ~/github/owen-extension
cd ~/github/owen-extension
npm install
npm run package
code --install-extension ./owen-browser-bridge-0.1.5.vsix --force
```

If the `code` command is not available, open VS Code, run `Shell Command: Install 'code' command in PATH`, then rerun the install command.

### Install the browser extension from the release ZIP or cloned repository

The Chrome/Edge browser extension is loaded separately from the VS Code extension.

If you downloaded `owen-browser-capture-browser-extension-*.zip` from a release, extract it first and select the extracted folder in the browser's **Load unpacked** dialog.

Microsoft Edge:

1. Open `edge://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the extracted release folder or the cloned `browser-extension` folder.
	- Windows: `C:\OWEN\github\owen-extension\browser-extension`
	- macOS: `~/github/owen-extension/browser-extension`

Google Chrome:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the extracted release folder or the cloned `browser-extension` folder.

After both extensions are installed, follow [Pairing Setup](#pairing-setup).

## Pairing Setup

Use this once after installing the VS Code extension and the browser extension.

### 1. Open the setup page

1. In VS Code, press `Ctrl+Shift+P` on Windows/Linux or `Cmd+Shift+P` on macOS.
2. Run `Owen Browser Bridge: Open Setup Page`.
3. Click **Start Server**.
4. The server listens on `127.0.0.1:17321` by default.

### 2. Copy the pairing token

1. On the setup page, click **Copy Pairing Token**.
2. VS Code copies the token to your clipboard without showing it on screen.

If the token ever needs to be replaced, click **Regenerate and Copy Token** and paste the new token into the browser extension again.

### 3. Paste the token into the browser extension

1. Open Chrome or Edge.
2. Click the **Owen Capture** browser extension icon.
3. Confirm `VS Code Port` is `17321` unless you changed the VS Code setting.
4. Paste the copied token into **Pairing Token**.
5. Optionally enter an **Investigation / Case** name such as `incident-12345` to group multiple tab captures together.
6. Keep **Accept Copilot browser actions** enabled if you want Copilot to send safe browser actions through the paired extension.
7. Choose whether to include **screenshot** and **HTML snapshot**.
8. Click **Save Settings**.

### 4. Send a browser page to VS Code

1. Open a page listed in **Allowed Hosts** on the setup page, such as `https://security.microsoft.com` or `https://portal.azure.com`.
2. Click the **Owen Capture** browser extension icon.
3. Click **Send Current Tab**.
4. The popup should show `Sent`.
5. In VS Code, run `Owen Browser Bridge: Show Latest Capture` to open the saved Markdown note.

Captured files are stored in the folder shown under **Capture Directory** on the setup page. The default layout is `raw/browser-captures/<host>/<group>/` under the current workspace. If **Investigation / Case** is empty, the extension tries to infer an incident or alert id from the URL, then falls back to the capture date.

### If the command is not visible

1. Confirm the VSIX is installed in VS Code.
2. Run `Developer: Reload Window` from the Command Palette.
3. Search again for `Owen Browser Bridge` in `Ctrl+Shift+P`.

### If the browser says a host is not allowed

Open `Owen Browser Bridge: Open Setup Page`, then use **Allowed Hosts** to add, edit, or remove accepted hosts. Exact hosts, full URLs, and wildcards such as `*.microsoft.com` are supported.

### Change the capture directory

Open `Owen Browser Bridge: Open Setup Page`, then use **Capture Directory** to save a workspace-relative path such as `raw/browser-captures` or an absolute path such as `C:\OWEN\Drive\wiki_raw_articles\browser-captures`. Click **Reset to Default** to remove the custom setting and return to the extension default.

## Copilot Integration

The VS Code extension contributes these Language Model Tools:

- `#getLatestBrowserCapture`: returns the latest received browser capture
- `#readBrowserCapture`: returns a capture by id, Markdown path, or JSON path
- `#readBrowserCaptureGroup`: returns every capture in a host or investigation group for correlation
- `#browserAct`: sends a safe action to the paired browser and returns the resulting page state

Example Copilot prompts:

```text
#getLatestBrowserCapture 방금 Defender 포탈에서 캡처한 alert를 분석해줘. 증거, 위험도, 추가 확인 항목, 권장 대응 순서로 정리해줘.
```

```text
#readBrowserCapture capture-20260605T120000Z-a1b2c3 이 캡처의 보안 경고 타임라인을 재구성해줘.
```

For multi-tab Defender or portal investigations:

```text
#readBrowserCaptureGroup security.microsoft.com/incident-12345 이 폴더의 모든 캡처를 하나의 인시던트 흐름으로 연관 분석해줘.
```

You can also omit the group to analyze the latest capture group, or pass only a host such as `security.microsoft.com` to read that host's newest group.

For paired browser control on allowed hosts:

```text
#browserAct { "action": "click", "text": "Evidence", "investigationName": "incident-12345" } Defender 인시던트의 Evidence 탭을 열고 결과 화면을 캡처해줘.
```

Supported actions are `readPage`, `capture`, `navigate`, `click`, `type`, and `waitForText`. Browser actions are delivered through the local paired extension, restricted by **Allowed Hosts**, and capture the resulting page by default.

Copilot can also read the generated Markdown/JSON/PNG files directly from the workspace.

## Quick Start

Full setup instructions are in [docs/install-and-use.md](docs/install-and-use.md).

```powershell
npm install
npm run compile
```

In VS Code, press `F5` to launch an Extension Development Host. Then run:

```text
Owen Browser Bridge: Open Setup Page
```

Click **Start Server**, click **Copy Pairing Token**, then load [browser-extension](browser-extension) as an unpacked extension in Edge or Chrome, paste the token, open an allowed portal page, and click **Send Current Tab**.

For the full pairing walkthrough, see [Pairing Setup](#pairing-setup).

## Release Process

Run this before creating every GitHub Release:

```powershell
npm run release:check
```

The release check compiles the VS Code extension, runs lint, packages the VSIX, packages the browser extension ZIP, and verifies that both release assets exist:

- `owen-browser-bridge-<version>.vsix`
- `owen-browser-capture-browser-extension-<version>.zip`

Upload both files to the GitHub Release for the same version tag.

When a `v*` tag is pushed to GitHub, `.github/workflows/release.yml` runs the same `npm run release:check` process and creates or updates the GitHub Release with both assets.

## Settings

- `owenBrowserBridge.port`: localhost port, default `17321`
- `owenBrowserBridge.captureDirectory`: workspace-relative or absolute capture folder, default `raw/browser-captures`. You can edit or reset this from the setup page with **Capture Directory**.
- `owenBrowserBridge.allowedHosts`: accepted page hostnames. You can edit this from the setup page with **Allowed Hosts**.
- `owenBrowserBridge.autoStart`: start the local server when VS Code starts

## Security Notes

- The server binds to `127.0.0.1` only.
- Browser requests require the pairing token stored in VS Code SecretStorage.
- Copilot browser actions require the same pairing token and the browser popup's **Accept Copilot browser actions** toggle.
- Default allowed hosts are Microsoft security/admin portals.
- Browser actions are limited to allowed hosts and refuse to type into password fields.
- Email addresses, IPv4 addresses, GUIDs, and bearer tokens are redacted before storage.
- Raw captures can still contain sensitive business/security context. Keep `raw/browser-captures/` out of git.

## Repository

Planned sync target: <https://github.com/towishy/owen-extension>
