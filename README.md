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

Captures are saved under `raw/browser-captures/YYYYMM/` by default as JSON, Markdown, and PNG files. That folder is ignored by git.

## Install From GitHub

Use these steps when installing Owen Browser Bridge on another Windows PC or on macOS.

### Option A. Install the VS Code extension from a GitHub Release

1. Open <https://github.com/towishy/owen-extension/releases>.
2. Download the latest `owen-browser-bridge-*.vsix` file.
3. In VS Code, press `Ctrl+Shift+P` on Windows/Linux or `Cmd+Shift+P` on macOS.
4. Run `Extensions: Install from VSIX...`.
5. Select the downloaded `.vsix` file.
6. Run `Developer: Reload Window` if the `Owen Browser Bridge` commands do not appear immediately.

### Option B. Build and install from the GitHub repository

Windows PowerShell:

```powershell
git clone https://github.com/towishy/owen-extension.git C:\OWEN\github\owen-extension
Set-Location C:\OWEN\github\owen-extension
npm install
npm run package
code --install-extension .\owen-browser-bridge-0.1.0.vsix --force
```

macOS terminal:

```bash
git clone https://github.com/towishy/owen-extension.git ~/github/owen-extension
cd ~/github/owen-extension
npm install
npm run package
code --install-extension ./owen-browser-bridge-0.1.0.vsix --force
```

If the `code` command is not available, open VS Code, run `Shell Command: Install 'code' command in PATH`, then rerun the install command.

### Install the browser extension from the cloned repository

The Chrome/Edge browser extension is loaded separately from the VS Code extension.

Microsoft Edge:

1. Open `edge://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the cloned `browser-extension` folder.
	- Windows: `C:\OWEN\github\owen-extension\browser-extension`
	- macOS: `~/github/owen-extension/browser-extension`

Google Chrome:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the cloned `browser-extension` folder.

After both extensions are installed, follow [Pairing Setup](#pairing-setup).

## Pairing Setup

Use this once after installing the VS Code extension and the browser extension.

### 1. Start the VS Code bridge

1. In VS Code, press `Ctrl+Shift+P` on Windows/Linux or `Cmd+Shift+P` on macOS.
2. Run `Owen Browser Bridge: Start Local Server`.
3. The server listens on `127.0.0.1:17321` by default.

### 2. Copy the pairing token

1. In VS Code, press `Ctrl+Shift+P` again on Windows/Linux or `Cmd+Shift+P` on macOS.
2. Run `Owen Browser Bridge: Copy Pairing Token`.
3. VS Code copies the token to your clipboard.

If the token ever needs to be replaced, run `Owen Browser Bridge: Regenerate Pairing Token` and paste the new token into the browser extension again.

### 3. Paste the token into the browser extension

1. Open Chrome or Edge.
2. Click the **Owen Capture** browser extension icon.
3. Confirm `VS Code Port` is `17321` unless you changed the VS Code setting.
4. Paste the copied token into **Pairing Token**.
5. Choose whether to include **screenshot** and **HTML snapshot**.
6. Click **Save Settings**.

### 4. Send a browser page to VS Code

1. Open an allowed page such as `https://security.microsoft.com`, `https://portal.azure.com`, or another configured host.
2. Click the **Owen Capture** browser extension icon.
3. Click **Send Current Tab**.
4. The popup should show `Sent`.
5. In VS Code, run `Owen Browser Bridge: Show Latest Capture` to open the saved Markdown note.

Captured files are stored in the currently open workspace under `raw/browser-captures/YYYYMM/`.

### If the command is not visible

1. Confirm the VSIX is installed in VS Code.
2. Run `Developer: Reload Window` from the Command Palette.
3. Search again for `Owen Browser Bridge` in `Ctrl+Shift+P`.

### If the browser says a host is not allowed

Add the host to `owenBrowserBridge.allowedHosts` in VS Code settings. Wildcards such as `*.microsoft.com` are supported.

## Copilot Integration

The VS Code extension contributes two Language Model Tools:

- `#getLatestBrowserCapture`: returns the latest received browser capture
- `#readBrowserCapture`: returns a capture by id, Markdown path, or JSON path

Example Copilot prompts:

```text
#getLatestBrowserCapture 방금 Defender 포탈에서 캡처한 alert를 분석해줘. 증거, 위험도, 추가 확인 항목, 권장 대응 순서로 정리해줘.
```

```text
#readBrowserCapture capture-20260605T120000Z-a1b2c3 이 캡처의 보안 경고 타임라인을 재구성해줘.
```

Copilot can also read the generated Markdown/JSON/PNG files directly from the workspace.

## Quick Start

Full setup instructions are in [docs/install-and-use.md](docs/install-and-use.md).

```powershell
npm install
npm run compile
```

In VS Code, press `F5` to launch an Extension Development Host. Then run:

```text
Owen Browser Bridge: Copy Pairing Token
```

Load [browser-extension](browser-extension) as an unpacked extension in Edge or Chrome, paste the token, open an allowed portal page, and click **Send Current Tab**.

For the full pairing walkthrough, see [Pairing Setup](#pairing-setup).

## Settings

- `owenBrowserBridge.port`: localhost port, default `17321`
- `owenBrowserBridge.captureDirectory`: workspace-relative capture folder, default `raw/browser-captures`
- `owenBrowserBridge.allowedHosts`: accepted page hostnames
- `owenBrowserBridge.autoStart`: start the local server when VS Code starts

## Security Notes

- The server binds to `127.0.0.1` only.
- Browser requests require the pairing token stored in VS Code SecretStorage.
- Default allowed hosts are Microsoft security/admin portals.
- Email addresses, IPv4 addresses, GUIDs, and bearer tokens are redacted before storage.
- Raw captures can still contain sensitive business/security context. Keep `raw/browser-captures/` out of git.

## Repository

Planned sync target: <https://github.com/towishy/owen-extension>
