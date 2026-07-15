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
- Capture quality score and findings for auth/loading/low-evidence states
- Optional element-only or region-only clipped screenshot evidence
- Optional HTML snapshot
- Optional visible-tab PNG screenshot

Captures are saved under `raw/browser-captures/<host>/<group>/` by default as JSON, Markdown, and PNG files. Each group also gets `_index.json` and `_summary.md` so Copilot can analyze related multi-page investigations together. That folder is ignored by git.

## Install From GitHub

Owen Browser Bridge has two components, and both must be installed:

- **VS Code extension** (`owen-browser-bridge-<version>.vsix`): runs the local bridge, stores captures, and exposes Copilot tools.
- **Edge/Chrome extension** (`owen-browser-capture-browser-extension-<version>.zip`): reads and controls the active browser tab after pairing.

### Requirements

- VS Code `1.120.0` or later.
- Microsoft Edge or Google Chrome with permission to load an unpacked extension.
- Local access to `127.0.0.1`. The default bridge port is `17321`.
- Node.js `22` and Git only when building from source. They are not required for release asset installation.

### Option A. Install both extensions from a GitHub Release

1. Open <https://github.com/towishy/owen-extension/releases>.
2. Open the newest non-draft release and download the VSIX, browser ZIP, and `SHA256SUMS.txt` shown under **Assets**.
3. Install `owen-browser-bridge-<version>.vsix` in VS Code:
   - Open the Command Palette with `Ctrl+Shift+P` on Windows/Linux or `Cmd+Shift+P` on macOS.
   - Run `Extensions: Install from VSIX...`.
   - Select the downloaded VSIX and wait for the installation confirmation.
   - Run `Developer: Reload Window` if the Owen Browser Bridge commands do not appear.
4. Extract `owen-browser-capture-browser-extension-<version>.zip` to a permanent local folder. Do not run the browser extension directly from inside the ZIP.
5. Open the extracted versioned folder and confirm that `manifest.json`, `protocol-runtime.js`, `background.js`, `popup.html`, `popup.js`, and `popup.css` are directly inside it.
6. Load that folder in Edge or Chrome using the [browser extension steps](#install-the-browser-extension).
7. Complete [Pairing Setup](#pairing-setup).

You can also install the downloaded VSIX from a terminal:

```powershell
code --install-extension "$HOME\Downloads\owen-browser-bridge-0.1.28.vsix" --force
```

```bash
code --install-extension "$HOME/Downloads/owen-browser-bridge-0.1.28.vsix" --force
```

### Option B. Build and install from the GitHub repository

Clone the repository and use `npm ci` so the dependency versions match `package-lock.json`. `npm run release:local` compiles, lints, packages both extensions, verifies the assets, and installs the generated VSIX into local VS Code.

Windows PowerShell:

```powershell
git clone https://github.com/towishy/owen-extension.git C:\OWEN\github\owen-extension
Set-Location C:\OWEN\github\owen-extension
npm ci
npm run release:local

$version = (Get-Content .\package.json -Raw | ConvertFrom-Json).version
$browserZip = ".\dist\owen-browser-capture-browser-extension-$version.zip"
$browserFolder = "$HOME\Applications\OwenBrowserBridge-$version"
New-Item -ItemType Directory -Force -Path $browserFolder | Out-Null
Expand-Archive -Path $browserZip -DestinationPath $browserFolder -Force
Write-Host "Load unpacked: $browserFolder\owen-browser-capture-browser-extension-$version"
```

macOS Terminal:

```bash
git clone https://github.com/towishy/owen-extension.git ~/github/owen-extension
cd ~/github/owen-extension
npm ci
npm run release:local

VERSION=$(node -p "require('./package.json').version")
BROWSER_DIR="$HOME/Applications/OwenBrowserBridge-$VERSION"
mkdir -p "$BROWSER_DIR"
unzip -o "./dist/owen-browser-capture-browser-extension-$VERSION.zip" -d "$BROWSER_DIR"
echo "Load unpacked: $BROWSER_DIR/owen-browser-capture-browser-extension-$VERSION"
```

Generated release files are written to `dist/`. To package without installing the VSIX, run `npm run release:check` instead. If the `code` command is unavailable on macOS, open VS Code and run `Shell Command: Install 'code' command in PATH`. On Windows, reinstall VS Code with **Add to PATH** enabled or install the VSIX through the Command Palette.

### Install the browser extension

The browser extension is loaded separately from the VS Code extension. Select the folder that directly contains `manifest.json`; selecting its parent causes a manifest-not-found error.

Use one of these folders:

- Release asset: the versioned folder created by extracting `owen-browser-capture-browser-extension-<version>.zip`.
- Source checkout: `browser-extension` in the cloned repository.

Microsoft Edge:

1. Open `edge://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the folder that directly contains `manifest.json`.
5. Pin **Owen Browser Bridge Agent** from the Extensions menu for easier pairing and status checks.

Google Chrome:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the folder that directly contains `manifest.json`.
5. Pin **Owen Browser Bridge Agent** from the Extensions menu.

After both extensions are installed, follow [Pairing Setup](#pairing-setup).

### Update an existing installation

1. Install the newer VSIX with `Extensions: Install from VSIX...` or `code --install-extension <path-to-vsix> --force`.
2. Run `Developer: Reload Window` in VS Code.
3. Extract the new browser ZIP and replace the files in the same unpacked-extension folder. Keeping the same folder preserves the browser extension identity and local pairing storage.
4. Open `edge://extensions` or `chrome://extensions` and click **Reload** on Owen Browser Bridge Agent.
5. Open the browser popup and confirm the port, pairing status, screenshot redaction profile, and **Accept Copilot browser actions** setting.
6. If you loaded the update from a different folder, copy a newly generated pairing token from VS Code and pair again.

## Recent Releases

The README keeps only the four most recent release highlights. See the full [CHANGELOG](CHANGELOG.md) or [GitHub Releases](https://github.com/towishy/owen-extension/releases) for complete history and downloadable assets.

### 0.1.30

- Added an adaptive Browser Agent Runtime with plan/progress tracking, loop-aware replanning, context compaction, evidence-based completion judgement, and constrained model fallback.
- Added `browser_agent` run, resume, get, and cancel lifecycle operations with persisted history, restart recovery, safety review, and local model/token metrics.
- Routed `planAndRun` through the adaptive runtime, added stale-batch and navigation-readiness guards, and exposed a risk-aware `custom.*` action plugin API.

### 0.1.29

- Fixed empty Copilot tool responses by exposing browser-state, capture, and action summaries as `LanguageModelTextPart` values while preserving structured JSON parts.
- Added direct `vscode.lm.invokeTool` regression coverage for non-empty capture and browser-state results.
- Changed the browser popup to a 460 px, two-column compact layout that avoids scrollbars even when connection settings are expanded.

### 0.1.28

- Redesigned the passive-agent popup around bridge health, compact capture controls, current-site permission state, and collapsible connection settings.
- Added live connection updates, pairing-token visibility, screenshot-dependent redaction controls, and clearer status guidance.
- Removed the manual investigation-name default so capture groups are supplied only by Copilot commands.

### 0.1.27

- Added protocol 3.0 command leases, ACK/completion ownership, idempotent result delivery, a persisted browser outbox, and retry backoff.
- Added persistent browser-agent identities, explicit multi-agent routing, optional per-site browser permissions, and durable workflow runtime state.
- Added the Browser Captures Explorer, SHA-256 capture manifests, storage status and deletion commands, release checksums, and one-release/one-tag retention automation.

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
7. On the target HTTPS page, click **Allow access to current site**. The browser extension requests access only for that origin; permanent `<all_urls>` access is not used.
8. Choose whether to include **screenshot** and **HTML snapshot**.
9. Click **Save changes**.

### 4. Control and capture the active browser page from VS Code

1. Open a page listed in **Allowed Hosts** on the setup page, such as `https://security.microsoft.com` or `https://portal.azure.com`.
2. In Copilot Chat, call `#browserAct { "action": "capture", "captureAfter": true, "includeScreenshot": true }` or ask Copilot to inspect the current tab.
3. Use `#getBrowserState` to read the active tab state, or run `Owen Browser Bridge: Show Latest Capture` to open the saved Markdown note.

### 5. Verify the installation

1. Confirm the setup page shows the local server as running on `127.0.0.1:17321` or your configured port.
2. Confirm the browser popup reports a saved pairing token and keeps **Accept Copilot browser actions** enabled.
3. Open an allowed test page and run `#getBrowserState` in Copilot Chat.
4. Run `#browserAct { "action": "capture", "captureAfter": true, "includeScreenshot": true }`.
5. Run `Owen Browser Bridge: Show Latest Capture` and verify that the Markdown, JSON, and optional PNG were written under the configured Capture Directory.
6. Expand **Browser Captures** in the VS Code Explorer to browse captures by host and group. Use its toolbar to refresh or inspect storage usage.

The browser popup is passive after pairing. It does not need to remain open, and there is no manual tab-send step.

Captured files are stored in the folder shown under **Capture Directory** on the setup page. The default layout is `raw/browser-captures/<host>/<group>/` under the current workspace. If **Investigation / Case** is empty, the extension tries to infer an incident or alert id from the URL, then falls back to the capture date.

### If the command is not visible

1. Confirm the VSIX is installed in VS Code.
2. Run `Developer: Reload Window` from the Command Palette.
3. Search again for `Owen Browser Bridge` in `Ctrl+Shift+P`.

### If the browser cannot connect or pairing fails

1. Confirm the VS Code setup page shows **Server running** before opening the browser popup.
2. Confirm the popup port matches `owenBrowserBridge.port`; the default is `17321`.
3. Generate a fresh token with **Regenerate and Copy Token**, paste it into the popup, and click **Save changes**.
4. Check that local firewall or endpoint policy is not blocking loopback traffic to `127.0.0.1`.
5. Reload the browser extension and run `Developer: Reload Window` in VS Code.

Never paste the pairing token into chat, issue trackers, screenshots, or committed files.

### If Load unpacked reports a manifest error

Open the extracted folders until `manifest.json` is visible, then select that exact folder. The release ZIP contains one versioned top-level folder, so selecting the extraction parent is one level too high.

### If the browser says a host is not allowed

Open `Owen Browser Bridge: Open Setup Page`, then use **Allowed Hosts** to add, edit, or remove accepted hosts. Exact hosts, full URLs, and wildcards such as `*.microsoft.com` are supported. Click **Allow All Domains** to accept captures and Copilot browser actions from any host, or **Restore Microsoft Defaults** to return to the default Microsoft security/admin portal list.

If the result is `HOST_PERMISSION_REQUIRED`, open the browser popup while the target page is active and click **Allow access to current site**. VS Code Allowed Hosts and browser site permission are separate checks; both must allow the target.

### Change the capture directory

Open `Owen Browser Bridge: Open Setup Page`, then use **Capture Directory** to save a workspace-relative path such as `raw/browser-captures` or an absolute path such as `C:\OWEN\Drive\wiki_raw_articles\browser-captures`. Click **Reset to Default** to remove the custom setting and return to the extension default.

## Copilot Integration

The VS Code extension contributes these Language Model Tools:

- `#getLatestBrowserCapture`: returns the latest received browser capture
- `#getBrowserState`: returns the latest shared browser session, active tab, capture paths, and structured `screenSummary`
- `#readBrowserCapture`: returns a capture by id, Markdown path, or JSON path
- `#readBrowserCaptureGroup`: returns every capture in a host or investigation group for correlation
- `#searchBrowserCaptures`: searches the global local capture catalog by text, host, group, and date
- `#browserRead`, `#browserInteract`, `#browserWorkflow`, `#browserEvidence`, `#browserAdmin`: compact category-specific action tools
- `#browserAgent`: runs an adaptive, evidence-aware browser goal with planning, replanning, resume, and cancellation
- `#browserAct`: compatibility tool exposing every browser action and input

Tool results expose readable summaries and capture Markdown as `LanguageModelTextPart` values, with structured payloads retained as JSON data parts. This keeps results visible in Copilot Chat while preserving machine-readable state for compatible callers.

Each Chrome/Edge installation keeps a stable browser agent id. With one active agent, routing is automatic. With multiple active agents, pass `targetAgentId` or set `owenBrowserBridge.preferredAgentId`; the bridge refuses ambiguous routing instead of choosing silently.

### Adaptive Browser Agent

Use `#browserAgent` when the goal needs multiple browser steps and the next action depends on the latest page state. An Agent Run observes the page before every action, keeps a plan/progress ledger, compacts long context, detects repeated states, replans, and judges completion from supplied evidence. Existing `planAndRun` calls are routed to this adaptive runtime for compatibility; explicit `runWorkflow` and browser jobs remain deterministic step executors.

```text
#browserAgent { "operation": "run", "goal": "Open the current Defender incident, verify severity and affected assets, and stop with evidence", "maxSteps": 12, "requiredClaims": ["severity", "affected assets"] }
#browserAgent { "operation": "get", "runId": "agent-run-..." }
#browserAgent { "operation": "resume", "runId": "agent-run-..." }
#browserAgent { "operation": "cancel", "runId": "agent-run-..." }
```

The default budget is 12 state-changing actions. The planner may choose only one action per observation. Three repeated browser fingerprints force replanning; five repetitions or three replans produce an operator handoff. Authentication, CAPTCHA, destructive targets, approvals, policy changes, downloads, uploads, and bulk actions stop for review. Browser workflows also stop remaining batch steps after navigation, active-tab, URL, focus, or relevant DOM changes.

Agent Runs are stored locally in VS Code global state with bounded plan, observation, action, effect, judgement, model, token, and fallback metrics. Interrupted active runs become resumable `partial` runs when the extension host restarts.

Trusted VS Code extensions can register a limited host-side action through the activation API. A plugin must use the `custom.*` namespace and declare `description`, `capability`, and `risk`; `browser-write` actions cannot claim low risk, destructive plugins are excluded from autonomous planning, and custom actions cannot invoke other custom actions.

```ts
const bridge = await vscode.extensions.getExtension<BrowserBridgeExtensionApi>('towishy.owen-browser-bridge')?.activate();
const registration = bridge?.registerAgentAction({
	name: 'custom.collect-case-evidence',
	description: 'Collect evidence using a domain-specific built-in browser action.',
	capability: 'evidence',
	risk: 'low',
	handler: (_input, context) => context.executeBuiltIn({ action: 'readPage', captureAfter: false })
});
```

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

Advanced actions are also available: `wait`, `waitPreset`, `scroll`, `hover`, `keyPress`, `selectOption`, `clearInput`, `listInteractables`, `inspectTargets`, `captureElement`, `captureRegion`, `back`, `forward`, `reload`, `openInNewTab`, `switchTab`, `closeTab`, `journeyCapture`, `paginateCapture`, `smartFormFill`, `conditionalWorkflow`, `multiTabCrawl`, `runtimeSnapshot`, `domDiffTimeline`, `ocrSnapshot`, `dataGapGuard`, `exportReplay`, `networkTraceCapture`, `safeDownloadAndHash`, `tableExtract`, `stateCheckpoint`, `rollbackToCheckpoint`, `humanReviewGate`, `bulkActionFromList`, `semanticWait`, `compareCaptureRuns`, `policyGuard`, `visualAssert`, `accessibilitySnapshot`, `mapForm`, `watchPageChanges`, `highlightEvidence`, `planAndRun`, `evidenceClaimCheck`, `tableWatchAndDiff`, `browserRunBundle`, `safeActionPreview`, `stableTargetProfile`, `guidedDrilldown`, `evidenceCompletenessCheck`, `failureExplainer`, `waitProfiler`, `automationHealthScore`, `sensitiveActionGuard`, `tabOrchestrator`, `popupGuard`, `returnToTab`, `tabRunSummary`, `buildEvidencePack`, `buildNavigationGraph`, `assertPageContract`, `createHandoff`, `selectorHealthReport`, `captureReviewQueue`, `startBrowserJob`, `getBrowserJob`, `cancelBrowserJob`, `recordWorkflow`, `replayWorkflow`, `listScenarioTemplates`, `saveScenarioTemplate`, `deleteScenarioTemplate`, `exportScenarioTemplates`, `runScenarioTemplate`, `resumeAfterAuth`, and `runWorkflow`.

`#browserAct` supports `preset`, `steps`, `goal`, `claim`, `requiredClaims`, `retries`, `retryProfile`, `effectPolicy`, `fallbackSelectors`, `fallbackTexts`, `autoHeal`, `selectorMemory`, `targetHint`, `targetScope`, `frameDepth`, `captureBeforeAfter`, `assertText`, `assertNoText`, `assertSelector`, `assertNotSelector`, `assertScreenshotChanged`, `watchDurationMs`, `highlightSelectors`, `highlightText`, `waitPreset`, `waitCandidates`, `contractName`, `contractSelectors`, `contractTexts`, `captureGroup`, `jobName`, `scenarioName`, `scenarioTemplates`, `templateVersion`, `tabRoles`, `expectedTabs`, `returnToRole`, `closeExtraTabs`, `onUnexpectedTab`, `keyColumns`, `detailSelector`, `regionX`, `regionY`, `regionWidth`, `regionHeight`, `regionPadding`, `urls`, `maxPages`, `maxTabs`, `nextSelector`, `nextText`, `extractSelectors`, `formFields`, `conditions`, `requiredFields`, `requiredTexts`, `acknowledgement`, `urlIncludes`, `tableSelector`, `checkpointName`, `approvalKeyword`, `itemSelector`, `semanticConditions`, `macroName`, `params`, `baseRunId`, and `policyProfile`.

Example: run scenario templates

```text
#browserAct { "action": "runScenarioTemplate", "scenarioName": "portalReadinessCheck", "params": { "contractName": "genericPortalReady" }, "captureAfter": false } check whether the current portal page is ready for automation.
#browserAct { "action": "runScenarioTemplate", "scenarioName": "defenderXdrIncidentTriage", "captureGroup": "defender-incident-12345", "params": { "alertsTableSelector": "table", "summarySelector": "main" }, "captureAfter": false } collect Defender XDR incident evidence and prepare a handoff.
#browserAct { "action": "runScenarioTemplate", "scenarioName": "sentinelLogCollection", "captureGroup": "sentinel-log-case-001", "tableSelector": "table", "captureAfter": false } collect Sentinel query result evidence.
```

Example: manage tabs and popups

```text
#browserAct { "action": "tabRunSummary", "tabRoles": { "main": ["127.0.0.1"], "auth": ["login"] }, "captureAfter": false } summarize current browser tabs by role.
#browserAct { "action": "tabOrchestrator", "tabRoles": { "main": ["admin.microsoft.com"], "auth": ["login.microsoftonline.com"] }, "expectedTabs": 2, "returnToRole": "main", "onUnexpectedTab": "capture", "captureAfter": false } classify tabs, flag unexpected popups, and return to the main tab.
#browserAct { "action": "popupGuard", "expectedTabs": 1, "onUnexpectedTab": "warn", "captureAfter": false } warn if an unexpected popup or warning tab is open.
#browserAct { "action": "returnToTab", "returnToRole": "main", "tabRoles": { "main": ["admin.microsoft.com"] }, "captureAfter": false } return to the main work tab.
```

Example: diagnose reliability before retrying

```text
#browserAct { "action": "failureExplainer", "captureAfter": false } explain the latest failed browser action and recommend the next retry.
#browserAct { "action": "waitProfiler", "waitCandidates": ["spinnerGone", "elementStable", "networkIdle"], "selector": "#data-table", "captureAfter": false } compare readiness waits for this page.
```

Example: score and guard automation safety

```text
#browserAct { "action": "automationHealthScore", "captureAfter": false } score whether this page is ready for automation.
#browserAct { "action": "sensitiveActionGuard", "actionTemplate": { "action": "click", "targetHint": "Delete" }, "captureAfter": false } block or warn before a destructive click.
```

Example: preview and profile a target before acting

```text
#browserAct { "action": "safeActionPreview", "actionTemplate": { "action": "click", "targetHint": "Evidence" }, "captureAfter": false } preview which element would be clicked and whether confirmation is needed.
#browserAct { "action": "stableTargetProfile", "targetHint": "Evidence", "captureAfter": false } rank stable selector and accessibility candidates for the Evidence target.
```

Example: drill down and check evidence completeness

```text
#browserAct { "action": "guidedDrilldown", "tableSelector": "#data-table", "matchText": "High", "detailSelector": "#details", "maxItems": 3, "captureAfter": true } open matching rows and collect detail text.
#browserAct { "action": "evidenceCompletenessCheck", "captureGroup": "incident-12345", "requiredClaims": ["severity", "timeline", "affected user"], "captureAfter": false } check whether the capture group covers required report claims.
```

Example: guarded goal execution and claim checking

```text
#browserAct { "action": "planAndRun", "goal": "verify the evidence table and highlight the important row", "tableSelector": "#data-table", "highlightSelectors": ["#data-table"], "captureAfter": false } plan and run a guarded evidence collection flow.
#browserAct { "action": "evidenceClaimCheck", "claim": "Alpha is Open and the READY_MARKER is visible", "tableSelector": "#data-table", "captureAfter": false } check whether the current page supports this report claim.
```

Example: table stability and run bundle

```text
#browserAct { "action": "tableWatchAndDiff", "tableSelector": "#data-table", "keyColumns": ["Name"], "watchDurationMs": 1500, "captureAfter": false } watch the table and summarize row changes.
#browserAct { "action": "browserRunBundle", "captureGroup": "incident-12345", "captureAfter": false } assemble the capture group, action logs, and bundle manifest for handoff.
```

Example: build an operational evidence package

```text
#browserAct { "action": "buildEvidencePack", "captureGroup": "incident-12345", "captureAfter": false } assemble the current investigation captures and action logs into an evidence pack.
#browserAct { "action": "buildNavigationGraph", "maxEntries": 80, "captureAfter": false } summarize the recent browser action flow as a navigation graph.
```

Example: readiness and page contract checks

```text
#browserAct { "action": "waitPreset", "waitPreset": "genericPortalReady", "timeoutMs": 60000, "captureAfter": false } wait until the portal page is ready enough to inspect.
#browserAct { "action": "assertPageContract", "contractSelectors": ["#data-table"], "contractTexts": ["READY_MARKER"], "captureAfter": false } verify the expected evidence page structure.
```

Example: inspect page structure and forms before acting

```text
#browserAct { "action": "accessibilitySnapshot", "maxEntries": 80, "captureAfter": false } summarize the page roles, names, and likely targets.
#browserAct { "action": "mapForm", "captureAfter": false } list form fields, required state, options, and stable selector hints before filling.
```

Example: watch a page transition and highlight evidence

```text
#browserAct { "action": "watchPageChanges", "watchDurationMs": 2500, "captureAfter": false } observe whether this page is still changing.
#browserAct { "action": "highlightEvidence", "highlightSelectors": ["#data-table", "#ready-text"], "captureAfter": true, "includeScreenshot": true, "investigationName": "incident-12345" } create highlighted evidence for the important table and readiness marker.
```

Example: assert the UI state after an action

```text
#browserAct { "action": "visualAssert", "assertText": "READY_MARKER", "assertSelector": "#data-table", "captureAfter": false } verify the current page is ready before collecting evidence.
```

To inspect recent automation evidence, run `Owen Browser Bridge: Show Action Trace` from the VS Code Command Palette. Text redaction uses `owenBrowserBridge.redactionProfile` and `owenBrowserBridge.customRedactionPatterns`. Screenshot redaction is selected in the browser popup and defaults to `standard`. Capture retention is disabled by default; set `owenBrowserBridge.captureRetentionDays` or `owenBrowserBridge.captureRetentionMaxItems` to opt in. Queue capacity is controlled by `owenBrowserBridge.commandQueueMaxSize`.

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

Click **Start Server**, click **Copy Pairing Token**, then load [browser-extension](browser-extension) as an unpacked extension in Edge or Chrome, paste the token, save the settings, and open an allowed portal page. Control and capture the active tab from Copilot Chat with `#browserAct`.

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

The release check compiles and lints the VS Code extension, runs protocol and HTTP integration tests, verifies all 82 action schemas, packages both extensions, and verifies release checksums:

- `dist/owen-browser-bridge-<version>.vsix`
- `dist/owen-browser-capture-browser-extension-<version>.zip`
- `dist/SHA256SUMS.txt`

Upload all three files to the GitHub Release for the same version tag.

When a `v*` tag is pushed to GitHub, `.github/workflows/release.yml` runs the same `npm run release:check` process and creates or updates the release. Only after the current assets upload successfully, the workflow deletes every older GitHub Release and remote tag, then verifies that exactly the current release and tag remain.

## Settings

- `owenBrowserBridge.port`: localhost port, default `17321`
- `owenBrowserBridge.captureDirectory`: workspace-relative or absolute capture folder, default `raw/browser-captures`. You can edit or reset this from the setup page with **Capture Directory**.
- `owenBrowserBridge.captureDirectoryByPlatform`: optional OS-specific capture folder map. Use `win32` for Windows and `darwin` for macOS; these override `captureDirectory` on the matching OS.
- `owenBrowserBridge.allowedHosts`: accepted page hostnames. You can edit this from the setup page with **Allowed Hosts**. Set it to an empty array, or click **Allow All Domains**, to accept any host.
- `owenBrowserBridge.autoStart`: start the local server when VS Code starts
- `owenBrowserBridge.preferredAgentId`: optional stable Chrome/Edge agent id used when more than one paired browser is active

## Security Notes

- The server binds to `127.0.0.1` only.
- Browser requests require the pairing token stored in VS Code SecretStorage.
- Copilot browser actions require the same pairing token and the browser popup's **Accept Copilot browser actions** toggle.
- Browser page access is requested per origin through optional host permissions; the manifest permanently allows only the loopback bridge hosts.
- Default allowed hosts are Microsoft security/admin portals.
- Browser actions are limited to allowed hosts and refuse to type into password fields.
- Email addresses, IPv4 addresses, GUIDs, and bearer tokens are redacted before storage.
- Each stored capture has an `_integrity/<capture-id>.json` manifest containing SHA-256 and byte size for its redacted JSON, Markdown, and optional PNG artifacts.
- Raw captures can still contain sensitive business/security context. Keep `raw/browser-captures/` out of git.

## Repository

Planned sync target: <https://github.com/towishy/owen-extension>
