# Install and Use

This project contains both sides of the bridge:

- VS Code extension: receives captures, stores files, and exposes Language Model Tools to Copilot
- Browser extension: captures the active Chrome/Edge tab and sends it to VS Code

## Install on Another Machine From GitHub

Use this section for a different Windows PC or a Mac.

### Install both extensions from GitHub Release

1. Open <https://github.com/towishy/owen-extension/releases>.
2. Download both release assets:
  - `owen-browser-bridge-*.vsix`
  - `owen-browser-capture-browser-extension-*.zip`
3. In VS Code, press `Ctrl+Shift+P` on Windows/Linux or `Cmd+Shift+P` on macOS.
4. Run `Extensions: Install from VSIX...`.
5. Select the downloaded `.vsix` file.
6. Extract `owen-browser-capture-browser-extension-*.zip` to a local folder.
7. Load the extracted browser extension folder in Edge or Chrome with **Load unpacked**.
8. Run `Developer: Reload Window` if the VS Code commands do not appear immediately.

### Build and install from source

Windows PowerShell:

```powershell
git clone https://github.com/towishy/owen-extension.git C:\OWEN\github\owen-extension
Set-Location C:\OWEN\github\owen-extension
npm install
npm run package
code --install-extension .\owen-browser-bridge-0.1.1.vsix --force
```

macOS terminal:

```bash
git clone https://github.com/towishy/owen-extension.git ~/github/owen-extension
cd ~/github/owen-extension
npm install
npm run package
code --install-extension ./owen-browser-bridge-0.1.1.vsix --force
```

If `code` is unavailable, open VS Code and run `Shell Command: Install 'code' command in PATH`.

### Install the browser extension from release ZIP or cloned repo

The browser extension is not installed by the VSIX. Load it from the extracted release ZIP or the cloned repository.

Microsoft Edge:

1. Open `edge://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the extracted release folder or `browser-extension` from the cloned repo.

Google Chrome:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the extracted release folder or `browser-extension` from the cloned repo.

Common folder locations:

- Windows: `C:\OWEN\github\owen-extension\browser-extension`
- macOS: `~/github/owen-extension/browser-extension`
- Release ZIP: the folder created after extracting `owen-browser-capture-browser-extension-*.zip`

After this, continue with the pairing steps below.

## 1. Build the VS Code Extension

From `C:\OWEN\github\owen-extension`:

```powershell
npm install
npm run compile
```

## 2. Run the VS Code Extension Locally

1. Open `C:\OWEN\github\owen-extension` in VS Code.
2. Press `F5`.
3. In the Extension Development Host, run `Owen Browser Bridge: Start Local Server` from the Command Palette.
4. Run `Owen Browser Bridge: Copy Pairing Token`.

The local server listens on `http://127.0.0.1:17321` by default.

## 3. Install the Browser Extension

### Microsoft Edge

1. Open `edge://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose `C:\OWEN\github\owen-extension\browser-extension`.

### Google Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose `C:\OWEN\github\owen-extension\browser-extension`.

## 4. Pair the Browser Extension

1. In VS Code, press `Ctrl+Shift+P` on Windows/Linux or `Cmd+Shift+P` on macOS.
2. Run `Owen Browser Bridge: Copy Pairing Token`.
3. VS Code copies the token to your clipboard.
4. In Chrome or Edge, click the Owen Capture browser extension icon.
5. Keep `VS Code Port` as `17321`, unless you changed `owenBrowserBridge.port`.
6. Paste the copied token into **Pairing Token**.
7. Select whether to include **screenshot** and **HTML snapshot**.
8. Click **Save Settings**.

If you need to rotate the token, run `Owen Browser Bridge: Regenerate Pairing Token` in VS Code, then paste the new token into the browser extension and click **Save Settings** again.

## 5. Capture a Portal Page

1. Open an allowed page, for example `https://security.microsoft.com`.
2. Click the Owen Capture browser extension icon.
3. Click **Send Current Tab**.
4. In VS Code, run `Owen Browser Bridge: Show Latest Capture`.

The capture is stored under:

```text
raw/browser-captures/YYYYMM/
  capture-*.json
  capture-*.md
  capture-*.png
```

## 6. Ask Copilot to Analyze It

Use Copilot Chat in the Extension Development Host or in a VS Code window where this extension is installed.

```text
#getLatestBrowserCapture 방금 캡처한 Defender alert를 분석해줘. 증거, 영향도, 추가 확인 항목, 대응 순서로 정리해줘.
```

For a specific capture:

```text
#readBrowserCapture capture-20260605T120000Z-a1b2c3 이 캡처를 기반으로 조사 보고서 초안을 만들어줘.
```

If tool reference is unavailable in your Copilot Chat build, open the generated Markdown file and ask Copilot to analyze the current file plus adjacent JSON/PNG capture assets.

## 7. Change Allowed Hosts

By default, the VS Code extension accepts captures only from:

- `security.microsoft.com`
- `security.microsoft365.com`
- `entra.microsoft.com`
- `portal.azure.com`
- `*.microsoft.com`

Update `owenBrowserBridge.allowedHosts` in VS Code settings to add more domains. Set it to an empty array only for a controlled local test.

Example:

```json
"owenBrowserBridge.allowedHosts": [
  "security.microsoft.com",
  "security.microsoft365.com",
  "entra.microsoft.com",
  "portal.azure.com",
  "*.microsoft.com",
  "example.com"
]
```

## Troubleshooting

### `Owen Browser Bridge` commands do not appear

1. Confirm the VSIX is installed.
2. Run `Developer: Reload Window` in VS Code.
3. Search `Owen Browser Bridge` again from `Ctrl+Shift+P`.

### Browser popup shows `host_not_allowed`

Add that page's hostname to `owenBrowserBridge.allowedHosts`. For Microsoft subdomains, `*.microsoft.com` covers hosts such as `security.microsoft.com` and `learn.microsoft.com`.

### Browser popup shows `unauthorized`

1. Run `Owen Browser Bridge: Copy Pairing Token` in VS Code.
2. Paste the token into the browser popup.
3. Click **Save Settings**.
4. Try **Send Current Tab** again.

### Browser popup shows `Cannot access a chrome:// URL`

Chrome and Edge block extensions from reading internal pages such as `chrome://extensions` or `edge://extensions`. Open a normal HTTPS page and try again.

## 8. Prepare for GitHub Sync

This local project is intended to sync to:

```text
https://github.com/towishy/owen-extension
```

Do not commit `raw/browser-captures/`, screenshots, or customer/security investigation data.

## 9. Release Checklist

Before creating a GitHub Release, run:

```powershell
npm run release:check
```

This command verifies the browser extension manifest, compiles and lints the VS Code extension, builds the VSIX, builds the browser extension ZIP, and checks both release assets:

- `owen-browser-bridge-<version>.vsix`
- `owen-browser-capture-browser-extension-<version>.zip`

Attach both files to the GitHub Release. The VSIX installs the VS Code side, and the ZIP is extracted and loaded as the unpacked Chrome/Edge browser extension.

Pushing a `v*` tag also triggers `.github/workflows/release.yml`, which runs the same release check and uploads both assets automatically.