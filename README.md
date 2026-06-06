# Owen Browser Bridge

Owen Browser Bridge is a two-part local bridge that lets GitHub Copilot in VS Code analyze browser data captured from Chrome or Edge.

```text
Chrome / Edge extension
	-> localhost HTTP bridge in this VS Code extension
	-> workspace capture files + VS Code Language Model Tools
	-> GitHub Copilot Chat analysis
```

The initial target is Defender, Entra, Azure portal, and similar security investigation pages where the browser has context that Copilot cannot otherwise inspect directly.

## New in 0.1.14

- Added `captureElement` for selector/targetHint-based panel or box evidence capture.
- Added `captureRegion` for explicit rectangle evidence capture by coordinates.
- Added region inputs: `regionX`, `regionY`, `regionWidth`, `regionHeight`, and `regionPadding`.

## New in 0.1.13

- Browser extension display name is now "Owen Browser Bridge Agent" in the extension list and popup.

## New in 0.1.12

- Target inspection with `inspectTargets` ranks visual and accessibility candidates before clicking or typing.
- Auto-healing target actions with `targetHint` and `autoHeal` retry likely candidates when selectors or text fail.
- Capture quality scoring reports auth, loading, and low-evidence states in `screenSummary.captureQuality`.
- Paired browser tab detection now accepts valid tab id `0` from Chrome or Edge.
- `readPage` and capture snapshots correctly include page state after capture quality scoring.

## What It Captures

- Current tab URL and title
- Visible page text
- Selected text
- Page headings, visible buttons/links, viewport data, and meta tags
- Capture quality score and findings for auth/loading/low-evidence states
- Optional element-only or region-only clipped screenshot evidence
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
code --install-extension .\owen-browser-bridge-0.1.14.vsix --force
```

macOS terminal:

```bash
git clone https://github.com/towishy/owen-extension.git ~/github/owen-extension
cd ~/github/owen-extension
npm install
npm run package
code --install-extension ./owen-browser-bridge-0.1.14.vsix --force
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
2. Click the **Owen Browser Bridge Agent** browser extension icon.
3. Confirm `VS Code Port` is `17321` unless you changed the VS Code setting.
4. Paste the copied token into **Pairing Token**.
5. Optionally enter an **Investigation / Case** name such as `incident-12345` to group multiple tab captures together.
6. Keep **Accept Copilot browser actions** enabled if you want Copilot to send safe browser actions through the paired extension.
7. Choose whether to include **screenshot** and **HTML snapshot**.
8. Click **Save Settings**.

### 4. Send a browser page to VS Code

1. Open a page listed in **Allowed Hosts** on the setup page, such as `https://security.microsoft.com` or `https://portal.azure.com`.
2. Click the **Owen Browser Bridge Agent** browser extension icon.
3. Click **Send Current Tab**.
4. The popup should show `Sent`.
5. In VS Code, run `Owen Browser Bridge: Show Latest Capture` to open the saved Markdown note.

Captured files are stored in the folder shown under **Capture Directory** on the setup page. The default layout is `raw/browser-captures/<host>/<group>/` under the current workspace. If **Investigation / Case** is empty, the extension tries to infer an incident or alert id from the URL, then falls back to the capture date.

### If the command is not visible

1. Confirm the VSIX is installed in VS Code.
2. Run `Developer: Reload Window` from the Command Palette.
3. Search again for `Owen Browser Bridge` in `Ctrl+Shift+P`.

### If the browser says a host is not allowed

Open `Owen Browser Bridge: Open Setup Page`, then use **Allowed Hosts** to add, edit, or remove accepted hosts. Exact hosts, full URLs, and wildcards such as `*.microsoft.com` are supported. Click **Allow All Domains** to accept captures and Copilot browser actions from any host, or **Restore Microsoft Defaults** to return to the default Microsoft security/admin portal list.

### Change the capture directory

Open `Owen Browser Bridge: Open Setup Page`, then use **Capture Directory** to save a workspace-relative path such as `raw/browser-captures` or an absolute path such as `C:\OWEN\Drive\wiki_raw_articles\browser-captures`. Click **Reset to Default** to remove the custom setting and return to the extension default.

## Copilot Integration

The VS Code extension contributes these Language Model Tools:

- `#getLatestBrowserCapture`: returns the latest received browser capture
- `#getBrowserState`: returns the latest shared browser session, active tab, capture paths, and structured `screenSummary`
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

To inspect the currently shared browser state before choosing the next action:

```text
#getBrowserState 현재 공유된 브라우저 탭에서 Copilot이 볼 수 있는 headings, interactables, form fields, tables를 요약해줘.
```

For paired browser control on allowed hosts:

```text
#browserAct { "action": "click", "text": "Evidence", "investigationName": "incident-12345" } Defender 인시던트의 Evidence 탭을 열고 결과 화면을 캡처해줘.
```

Supported actions are `readPage`, `capture`, `navigate`, `click`, `type`, and `waitForText`. `readPage` returns a structured `screenSummary` with headings, landmarks, interactables, form fields, tables, viewport, text sample, and capture quality. Browser actions are delivered through the local paired extension, restricted by **Allowed Hosts**, and capture the resulting page by default.

Advanced actions are also available: `wait`, `scroll`, `hover`, `keyPress`, `selectOption`, `clearInput`, `listInteractables`, `inspectTargets`, `captureElement`, `captureRegion`, `back`, `forward`, `reload`, `openInNewTab`, `switchTab`, `closeTab`, `journeyCapture`, `paginateCapture`, `smartFormFill`, `conditionalWorkflow`, `multiTabCrawl`, `runtimeSnapshot`, `domDiffTimeline`, `ocrSnapshot`, `dataGapGuard`, `exportReplay`, `networkTraceCapture`, `safeDownloadAndHash`, `tableExtract`, `stateCheckpoint`, `rollbackToCheckpoint`, `humanReviewGate`, `bulkActionFromList`, `semanticWait`, `compareCaptureRuns`, `policyGuard`, `recordWorkflow`, `replayWorkflow`, `resumeAfterAuth`, and `runWorkflow`.

`#browserAct` supports `preset`, `steps`, `retries`, `retryProfile`, `fallbackSelectors`, `fallbackTexts`, `autoHeal`, `targetHint`, `targetScope`, `frameDepth`, `captureBeforeAfter`, `regionX`, `regionY`, `regionWidth`, `regionHeight`, `regionPadding`, `urls`, `maxPages`, `maxTabs`, `nextSelector`, `nextText`, `extractSelectors`, `formFields`, `conditions`, `requiredFields`, `requiredTexts`, `acknowledgement`, `urlIncludes`, `tableSelector`, `checkpointName`, `approvalKeyword`, `itemSelector`, `semanticConditions`, `macroName`, `params`, `baseRunId`, and `policyProfile` so Copilot can run resilient workflows, inspect ranked visual/accessibility targets, capture element/region evidence, form automation, conditional branching, runtime snapshots, gap detection, replay export, network traces, table extraction, checkpoint rollback, manual review gates, policy checks, and reusable macro playback.

`wait.kind` additionally supports `networkIdle` and `requestDone` so workflows can wait for API/resource completion patterns.

Example: deep targeting across Shadow DOM and same-origin iframes

```text
#browserAct { "action": "click", "targetHint": "Evidence", "targetScope": "allFrames", "frameDepth": 3, "retryProfile": "aggressive", "captureAfter": true, "investigationName": "incident-12345" } iframe 안쪽 후보까지 탐색해서 Evidence 탭을 열어줘.
```

Example: record and replay a macro workflow

```text
#browserAct { "action": "recordWorkflow", "macroName": "incident-open", "steps": [{ "action": "click", "text": "Incidents" }, { "action": "click", "text": "Open" }] }
#browserAct { "action": "replayWorkflow", "macroName": "incident-open", "captureBeforeAfter": true, "captureAfter": true, "investigationName": "incident-12345" }
```

Example: capture only a target panel

```text
#browserAct { "action": "captureElement", "selector": "[data-testid='event-panel']", "regionPadding": 8, "captureAfter": true, "includeScreenshot": true, "investigationName": "incident-12345" } 이 패널만 증적 이미지로 캡처하고 핵심 내용을 요약해줘.
```

Example: capture only a fixed region

```text
#browserAct { "action": "captureRegion", "regionX": 420, "regionY": 180, "regionWidth": 760, "regionHeight": 420, "captureAfter": true, "includeScreenshot": true, "investigationName": "incident-12345" } 지정한 프레임 영역만 증적으로 캡처해줘.
```

`ocrSnapshot` returns screenshot plus DOM text hints. True OCR engine embedding is not included in this runtime.

Example: link-driven journey capture + auto analysis

```text
#browserAct {
	"action": "journeyCapture",
	"urls": [
		"https://security.microsoft.com/incidents",
		"https://security.microsoft.com/incidents/12345"
	],
	"maxPages": 2,
	"extractSelectors": {
		"incidentId": "[data-testid='incident-id']",
		"severity": "[data-testid='severity']"
	},
	"investigationName": "incident-12345"
} 이 링크들을 순서대로 열고 페이지별 핵심 필드와 캡처를 수집한 뒤, 누락 데이터 갭까지 분석해줘.
```

`closeTab` is safety-gated and requires `confirmDangerous: true`.

If navigation hits an authentication page, browser control pauses safely and asks you to finish sign-in in the same browser tab. After sign-in, type `완료` in Copilot Chat and continue with:

```text
#browserAct { "action": "resumeAfterAuth" }
```

Copilot can also read the generated Markdown/JSON/PNG files directly from the workspace.

## Quick Start

Full setup instructions are in [docs/install-and-use.md](docs/install-and-use.md).
AI-agent usage guidance is in [docs/ai-agent-browser-control-guide.md](docs/ai-agent-browser-control-guide.md).

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

Use this local release command before creating every GitHub Release:

```powershell
npm run release:local
```

`npm run release:local` runs `release:check` and then installs the built VSIX into your local VS Code automatically.

If you only need CI-style validation without local install, run:

```powershell
npm run release:check
```

The release check compiles the VS Code extension, runs lint, packages the VSIX, packages the browser extension ZIP, and verifies that both release assets exist:

- `dist/owen-browser-bridge-<version>.vsix`
- `dist/owen-browser-capture-browser-extension-<version>.zip`

Upload both files to the GitHub Release for the same version tag.

When a `v*` tag is pushed to GitHub, `.github/workflows/release.yml` runs the same `npm run release:check` process and creates or updates the GitHub Release with both assets.

## Settings

- `owenBrowserBridge.port`: localhost port, default `17321`
- `owenBrowserBridge.captureDirectory`: workspace-relative or absolute capture folder, default `raw/browser-captures`. You can edit or reset this from the setup page with **Capture Directory**.
- `owenBrowserBridge.captureDirectoryByPlatform`: optional OS-specific capture folder map. Use `win32` for Windows and `darwin` for macOS; these override `captureDirectory` on the matching OS.
- `owenBrowserBridge.allowedHosts`: accepted page hostnames. You can edit this from the setup page with **Allowed Hosts**. Set it to an empty array, or click **Allow All Domains**, to accept any host.
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
