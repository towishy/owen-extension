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

```powershell
git clone https://github.com/towishy/owen-extension.git C:\OWEN\github\owen-extension
Set-Location C:\OWEN\github\owen-extension
npm install
npm run package
code --install-extension .\owen-browser-bridge-0.1.24.vsix --force
```

macOS terminal:

```bash
git clone https://github.com/towishy/owen-extension.git ~/github/owen-extension
cd ~/github/owen-extension
npm install
npm run package
code --install-extension ./owen-browser-bridge-0.1.24.vsix --force
```

If `code` is unavailable, open VS Code and run `Shell Command: Install 'code' command in PATH`.

### Install the browser extension from release ZIP or cloned repo
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
3. In the Extension Development Host, run `Owen Browser Bridge: Open Setup Page` from the Command Palette.
4. Click **Start Server**.
5. Click **Copy Pairing Token**.

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
2. Run `Owen Browser Bridge: Open Setup Page`.
3. Click **Start Server** if the setup page shows the server is stopped.
4. Click **Copy Pairing Token**.
5. VS Code copies the token to your clipboard without showing it on screen.
6. In Chrome or Edge, click the Owen Browser Bridge Agent browser extension icon.
7. Keep `VS Code Port` as `17321`, unless you changed `owenBrowserBridge.port`.
8. Paste the copied token into **Pairing Token**.
9. Optionally enter an **Investigation / Case** name such as `incident-12345` when you plan to capture several tabs for the same investigation.
10. Keep **Accept Copilot browser actions** enabled if you want Copilot to control the paired browser on allowed hosts.
11. Select whether to include **screenshot** and **HTML snapshot**.
12. Click **Save Settings**.

If you need to rotate the token, click **Regenerate and Copy Token** on the setup page, then paste the new token into the browser extension and click **Save Settings** again.

## 5. Capture a Portal Page

1. Open a page listed in **Allowed Hosts** on the setup page, for example `https://security.microsoft.com`.
2. Click the Owen Browser Bridge Agent browser extension icon.
3. Click **Send Current Tab**.
4. In VS Code, run `Owen Browser Bridge: Show Latest Capture`.

The capture is stored under the folder shown in **Capture Directory** on the setup page. By default, this is:

```text
raw/browser-captures/<host>/<group>/
  _index.json
  _summary.md
  capture-*.json
  capture-*.md
  capture-*.png
```

The `<host>` folder comes from the captured page hostname. The `<group>` folder uses **Investigation / Case** when provided, otherwise the extension tries to infer an incident or alert id from the URL and falls back to the capture date.

## 6. Ask Copilot to Analyze It

Use Copilot Chat in the Extension Development Host or in a VS Code window where this extension is installed.

```text
#getLatestBrowserCapture 방금 캡처한 Defender alert를 분석해줘. 증거, 영향도, 추가 확인 항목, 대응 순서로 정리해줘.
```

For a specific capture:

```text
#readBrowserCapture capture-20260605T120000Z-a1b2c3 이 캡처를 기반으로 조사 보고서 초안을 만들어줘.
```

For all captures in a related host or investigation group:

```text
#readBrowserCaptureGroup security.microsoft.com/incident-12345 이 폴더의 모든 캡처를 하나의 Defender 인시던트 흐름으로 연관 분석해줘.
```

If you omit the group, `#readBrowserCaptureGroup` reads the latest capture group. If you pass only a host such as `security.microsoft.com`, it reads that host's newest group.

To inspect the currently shared browser state before choosing the next action:

```text
#getBrowserState 현재 공유된 브라우저 탭에서 Copilot이 볼 수 있는 headings, interactables, form fields, tables를 요약해줘.
```

For paired browser control:

```text
#browserAct { "action": "click", "text": "Evidence", "investigationName": "incident-12345" } Evidence 탭을 열고 결과 화면을 캡처해줘.
```

`#browserAct` supports `readPage`, `capture`, `navigate`, `click`, `type`, and `waitForText`. `readPage` returns a structured `screenSummary` with headings, landmarks, interactables, form fields, tables, viewport, text sample, and capture quality. Actions are delivered through the paired browser extension, limited to **Allowed Hosts**, and capture the resulting page by default.

Advanced actions are available for richer automation: `wait`, `waitPreset`, `scroll`, `hover`, `keyPress`, `selectOption`, `clearInput`, `listInteractables`, `inspectTargets`, `captureElement`, `captureRegion`, `back`, `forward`, `reload`, `openInNewTab`, `switchTab`, `closeTab`, `journeyCapture`, `paginateCapture`, `smartFormFill`, `conditionalWorkflow`, `multiTabCrawl`, `runtimeSnapshot`, `domDiffTimeline`, `ocrSnapshot`, `dataGapGuard`, `exportReplay`, `networkTraceCapture`, `safeDownloadAndHash`, `tableExtract`, `stateCheckpoint`, `rollbackToCheckpoint`, `humanReviewGate`, `bulkActionFromList`, `semanticWait`, `compareCaptureRuns`, `policyGuard`, `visualAssert`, `accessibilitySnapshot`, `mapForm`, `watchPageChanges`, `highlightEvidence`, `planAndRun`, `evidenceClaimCheck`, `tableWatchAndDiff`, `browserRunBundle`, `safeActionPreview`, `stableTargetProfile`, `guidedDrilldown`, `evidenceCompletenessCheck`, `failureExplainer`, `waitProfiler`, `automationHealthScore`, `sensitiveActionGuard`, `tabOrchestrator`, `popupGuard`, `returnToTab`, `tabRunSummary`, `buildEvidencePack`, `buildNavigationGraph`, `assertPageContract`, `createHandoff`, `selectorHealthReport`, `captureReviewQueue`, `startBrowserJob`, `getBrowserJob`, `cancelBrowserJob`, `runScenarioTemplate`, `resumeAfterAuth`, and `runWorkflow`.

`#browserAct` also supports resilient workflow and traversal inputs: `preset`, `steps`, `scenarioName`, `scenarioTemplates`, `goal`, `claim`, `requiredClaims`, `retries`, `fallbackSelectors`, `fallbackTexts`, `autoHeal`, `targetHint`, `regionX`, `regionY`, `regionWidth`, `regionHeight`, `regionPadding`, `urls`, `maxPages`, `nextSelector`, `nextText`, `extractSelectors`, `urlIncludes`, `tableSelector`, `keyColumns`, `waitCandidates`, `detailSelector`, `tabRoles`, `expectedTabs`, `returnToRole`, `closeExtraTabs`, `onUnexpectedTab`, `checkpointName`, `approvalKeyword`, `itemSelector`, `semanticConditions`, `baseRunId`, `policyProfile`, `waitPreset`, `contractName`, `contractSelectors`, `contractTexts`, `captureGroup`, `jobName`, and `params`.

Partial evidence capture examples:

```text
#browserAct { "action": "captureElement", "targetHint": "Process Name", "regionPadding": 10, "captureAfter": true, "includeScreenshot": true, "investigationName": "case-001" } 특정 프로세스 박스만 캡처해줘.
```

```text
#browserAct { "action": "captureRegion", "regionX": 300, "regionY": 220, "regionWidth": 860, "regionHeight": 480, "captureAfter": true, "includeScreenshot": true, "investigationName": "case-001" } 지정한 영역만 캡처해줘.
```

URL traversal example:

```text
#browserAct {
  "action": "journeyCapture",
  "urls": ["https://security.microsoft.com/incidents", "https://security.microsoft.com/incidents/12345"],
  "maxPages": 2,
  "extractSelectors": {
    "incidentId": "[data-testid='incident-id']",
    "status": "[data-testid='status']"
  },
  "investigationName": "incident-12345"
} 이 URL들을 순차 방문해서 캡처/핵심필드 수집 후 분석해줘.
```

For safety, `closeTab` is blocked unless `confirmDangerous: true` is explicitly provided.

If the browser is redirected to an authentication page during automation, the action pauses. Complete sign-in in the same browser tab, then type `완료` in Copilot Chat and run:

```text
#browserAct { "action": "resumeAfterAuth" }
```

If tool reference is unavailable in your Copilot Chat build, open the generated Markdown file and ask Copilot to analyze the current file plus adjacent JSON/PNG capture assets.

For a tool-oriented guide that another AI agent can follow directly, see [AI Agent Browser Control Guide](ai-agent-browser-control-guide.md).

## 7. Change Allowed Hosts

By default, the VS Code extension accepts captures only from:

- `security.microsoft.com`
- `security.microsoft365.com`
- `entra.microsoft.com`
- `portal.azure.com`
- `*.microsoft.com`

Use **Allowed Hosts** on `Owen Browser Bridge: Open Setup Page` to add, edit, or remove accepted domains. Exact hosts, full URLs, and wildcards such as `*.microsoft.com` are supported. Click **Allow All Domains** to accept captures and Copilot browser actions from any host, or **Restore Microsoft Defaults** to return to the default Microsoft security/admin portal list.

You can also update `owenBrowserBridge.allowedHosts` directly in VS Code settings. Set it to an empty array only for a controlled local test.

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

## 8. Change Capture Directory

Use **Capture Directory** on `Owen Browser Bridge: Open Setup Page` to choose where JSON, Markdown, and PNG capture files are stored.

- Enter a workspace-relative path such as `raw/browser-captures`.
- Enter an absolute path such as `C:\OWEN\Drive\wiki_raw_articles\browser-captures`.
- Enter separate Windows and Mac directory paths when the same VS Code settings sync across multiple machines.
- Click **Save Directory** to update `owenBrowserBridge.captureDirectory`.
- Click **Save OS Directories** to update `owenBrowserBridge.captureDirectoryByPlatform.win32` and `owenBrowserBridge.captureDirectoryByPlatform.darwin`.
- Click **Reset to Default** to delete the custom setting and return to `raw/browser-captures`.

Settings JSON example:

```json
"owenBrowserBridge.captureDirectoryByPlatform": {
  "win32": "C:\\OWEN\\Drive\\wiki_raw_articles\\browser-captures",
  "darwin": "/Users/owen/work/wiki_raw_articles/browser-captures"
}
```

## Troubleshooting

### `Owen Browser Bridge` commands do not appear

1. Confirm the VSIX is installed.
2. Run `Developer: Reload Window` in VS Code.
3. Search `Owen Browser Bridge` again from `Ctrl+Shift+P`.

### Browser popup shows `host_not_allowed`

Open `Owen Browser Bridge: Open Setup Page` and add that page's hostname under **Allowed Hosts**. For Microsoft subdomains, `*.microsoft.com` covers hosts such as `security.microsoft.com` and `learn.microsoft.com`.

### Browser popup shows `unauthorized`

1. Run `Owen Browser Bridge: Open Setup Page` in VS Code.
2. Click **Copy Pairing Token**.
3. Paste the token into the browser popup.
4. Click **Save Settings**.
5. Try **Send Current Tab** again.

### `#browserAct` times out

1. Confirm the browser extension popup has **Accept Copilot browser actions** enabled.
2. Confirm the pairing token and port are saved in the browser popup.
3. Keep an allowed Chrome/Edge tab active while Copilot waits for the action result.
4. The extension polls for commands about every 30 seconds, so short delays are expected.

### Inspect recent browser action traces

Run `Owen Browser Bridge: Show Action Trace` from the VS Code Command Palette. The command opens a Markdown view of recent action log entries, including command ids, action names, step counts, before/after diff metadata, and stored capture links when available.

For uncertain portal pages, use `#browserAct { "action": "accessibilitySnapshot" }` to inspect role/name targets and `#browserAct { "action": "mapForm" }` before `smartFormFill`. Use `watchPageChanges` after navigation or sign-in transitions, and `highlightEvidence` when a screenshot should visually mark the table, panel, or status text used as evidence.

After collecting related captures, use `buildEvidencePack` to write `_evidence-pack.md` and `_evidence-pack.json` into the capture group, and `buildNavigationGraph` to write recent action-flow graph files under `_navigation-graphs/`. Use `waitPreset` and `assertPageContract` before extraction-heavy steps, and `createHandoff`, `selectorHealthReport`, or `captureReviewQueue` when a browser run needs manual review.

Use `planAndRun` when the operator gives a goal instead of exact steps, `evidenceClaimCheck` before writing report claims, and `tableWatchAndDiff` when a portal grid may refresh in place. Use `browserRunBundle` to create `_run-bundles/<id>/` under a capture group for handoff.

Use `safeActionPreview` and `stableTargetProfile` before uncertain clicks. Use `guidedDrilldown` to open matching table/list rows and collect detail panel text. Use `evidenceCompletenessCheck` to create `_evidence-completeness.md/json` under a capture group before final report handoff.

Use `automationHealthScore` before long automation runs, `waitProfiler` when readiness is flaky, `sensitiveActionGuard` before destructive labels, and `failureExplainer` immediately after a failed run. Use `tabRunSummary` and `tabOrchestrator` before OAuth, download, or admin-portal flows that may open extra tabs, and `popupGuard` when an unexpected tab should pause automation.

Use `runScenarioTemplate` for repeatable browser tasks. Generic templates include `portalReadinessCheck`, `evidenceTableReview`, `safeDestructiveAction`, `multiTabAuthFlow`, `formFillAndVerify`, `downloadEvidenceCapture`, `flakyUiRecovery`, `guidedDrilldownEvidence`, `operatorHandoff`, and `backgroundJobWorkflow`. Microsoft Security templates include `defenderXdrIncidentTriage`, `defenderXdrAlertEvidenceReview`, `sentinelLogCollection`, `sentinelIncidentCorrelation`, `entraRiskySignInReview`, `entraAuditTrailCapture`, `mdeDeviceTimelineReview`, `mdeAdvancedHuntingCollection`, `mdoEmailThreatReview`, `defenderForIdentityLateralMovementReview`, `defenderForCloudPostureReview`, `purviewDlpIncidentReview`, and `securityPortalHandoffBundle`.

```text
#browserAct { "action": "runScenarioTemplate", "scenarioName": "defenderXdrIncidentTriage", "captureGroup": "defender-incident-12345", "params": { "alertsTableSelector": "table", "summarySelector": "main" }, "captureAfter": false }
#browserAct { "action": "runScenarioTemplate", "scenarioName": "sentinelLogCollection", "captureGroup": "sentinel-log-case-001", "tableSelector": "table", "captureAfter": false }
```

### Configure capture redaction

Stored JSON and Markdown captures use `owenBrowserBridge.redactionProfile` before files are written. The default is `standard`; use `strict` for broader token-like string masking or `off` only for controlled local tests. Add site-specific JavaScript regular expression strings to `owenBrowserBridge.customRedactionPatterns` when a portal exposes sensitive identifiers with a custom format.

### Browser popup shows `Cannot access a chrome:// URL`

Chrome and Edge block extensions from reading internal pages such as `chrome://extensions` or `edge://extensions`. Open a normal HTTPS page and try again.

## 9. Prepare for GitHub Sync

This local project is intended to sync to:

```text
https://github.com/towishy/owen-extension
```

Do not commit `raw/browser-captures/`, screenshots, or customer/security investigation data.

## 10. Release Checklist

Before creating a GitHub Release from your local machine, run:

```powershell
npm run release:local
```

`release:local` runs the full release checks and then installs the generated VSIX into local VS Code automatically.

If you only want validation/package checks without local install, run:

```powershell
npm run release:check
```

This command verifies the browser extension manifest, compiles and lints the VS Code extension, builds the VSIX, builds the browser extension ZIP, and checks both release assets:

- `dist/owen-browser-bridge-<version>.vsix`
- `dist/owen-browser-capture-browser-extension-<version>.zip`

Attach both files to the GitHub Release. The VSIX installs the VS Code side, and the ZIP is extracted and loaded as the unpacked Chrome/Edge browser extension.

Pushing a `v*` tag also triggers `.github/workflows/release.yml`, which runs the same release check and uploads both assets automatically.