# AI Agent Browser Control Guide

This guide explains how another AI agent should use Owen Browser Bridge browser-control features safely and consistently.

## Purpose

Owen Browser Bridge lets an AI agent inspect and control a paired Chrome or Edge browser through the VS Code extension and browser extension. Use it when the user asks an agent to analyze a live browser page, navigate an allowed portal, collect evidence, extract table data, or continue an investigation after authentication.

The bridge is designed for operator-supervised work. Do not use it to bypass authentication, enter secrets, or perform destructive actions without explicit confirmation.

## Required Setup

Before calling browser-control actions, confirm these conditions:

1. The VS Code extension is installed and the local server is running.
2. The browser extension is loaded in Chrome or Edge.
3. The browser extension has the current pairing token.
4. **Accept Copilot browser actions** is enabled in the browser extension popup.
5. The active tab host is allowed by `owenBrowserBridge.allowedHosts`.
6. The user is signed in manually when a portal requires authentication.

After this one-time setup, the browser extension is passive. The agent starts capture, inspection, navigation, and guarded downloads from VS Code; the operator does not open the popup or click a manual tab-send button for each page.

Default local bridge URL:

```text
http://127.0.0.1:17321
```

Default capture output:

```text
raw/browser-captures/<host>/<group>/
```

## Tool Names

In GitHub Copilot Chat, use the contributed tool reference names:

| Tool | Use when |
|---|---|
| `#browserAct` | Control the paired browser or run workflows |
| `#getBrowserState` | Read the latest shared browser session, active tab, capture paths, and structured screen summary |
| `#getLatestBrowserCapture` | Read the latest capture |
| `#readBrowserCapture` | Read one capture by id/path |
| `#readBrowserCaptureGroup` | Read all captures in a host or investigation group |
| `#searchBrowserCaptures` | Search capture metadata across hosts and groups |
| `#browserRead` | Run compact read/readiness actions |
| `#browserInteract` | Run direct interaction and navigation actions |
| `#browserWorkflow` | Run multi-step workflows and scenarios |
| `#browserAgent` | Run, resume, inspect, or cancel an adaptive evidence-aware browser goal |
| `#browserEvidence` | Capture, validate, and package evidence |
| `#browserAdmin` | Manage jobs, macros, templates, and review queues |

Some agent hosts may expose the underlying tool ids such as `browser_act` or `get_browser_state`. If `#browserAct` or `#getBrowserState` is unavailable, try the snake_case id or inspect the available tool list.

The tools return readable summaries and capture Markdown as `LanguageModelTextPart` values and retain structured payloads as JSON data parts. If a host shows an empty tool response, verify that it is running version 0.1.29 or newer and reload the VS Code window after installing the VSIX.

`#browserAct { "action": "readPage" }` and `#getBrowserState` return `screenSummary`, a compact structured page state for agent planning. Prefer it over raw visible text when choosing selectors or deciding the next action. It includes headings, landmarks, interactables, form fields, tables, viewport, a text sample, and capture quality findings.

## Direct HTTP Mode

Agents with local HTTP access can enqueue actions directly instead of using a chat tool. The request must include the pairing token.

```http
POST http://127.0.0.1:17321/commands/enqueue
X-Owen-Bridge-Token: <pairing-token>
Content-Type: application/json
```

Example body:

```json
{
  "action": "capture",
  "captureAfter": true,
  "includeScreenshot": true,
  "investigationName": "incident-12345"
}
```

The `/commands/enqueue` response includes the queued command and completion result. Browser actions are executed by the paired browser extension through near-immediate long polling, with a 30-second alarm fallback if the MV3 service worker is suspended.

Protocol 3.0 leases each command to one stable browser agent id. The browser ACKs the lease before execution and persists results in an outbox until the VS Code bridge accepts them. Duplicate delivery from a lost HTTP response is idempotent. When multiple agents are active, include `"targetAgentId": "agent-..."` or configure `owenBrowserBridge.preferredAgentId`; ambiguous routing fails instead of selecting a browser silently.

Do not ask the user to paste the pairing token into chat. If a token is required and not already available to the calling environment, ask the user to enter it directly in the browser extension or VS Code setup UI.

## Core Action Pattern

Use this shape for most calls:

```json
{
  "action": "<actionName>",
  "targetAgentId": "<optional-stable-agent-id>",
  "captureAfter": true,
  "includeScreenshot": true,
  "investigationName": "<case-or-task-name>",
  "timeoutMs": 60000
}
```

For high-risk navigation or multi-page actions, include:

```json
{
  "acknowledgement": "CONFIRM_BROWSER_ACTION"
}
```

For clicks, typing, scrolling, or selections where a silent no-op is unacceptable, include `"effectPolicy": "require"`. The result records URL, DOM, scroll, focus, and target-state changes. Use `observe` when a no-effect result should be reported without failing the action.

## Adaptive Agent Runs

Use `#browserAgent` for a goal whose next step depends on the result of the previous step. Existing `planAndRun` calls use the same adaptive runtime for compatibility. Use `#browserWorkflow`, scenario templates, or browser jobs for deterministic, already-known procedures.

```json
{
  "operation": "run",
  "goal": "Verify the current incident severity and affected assets with visible evidence",
  "maxSteps": 12,
  "requiredClaims": ["severity", "affected assets"]
}
```

The VS Code host performs `observe -> compact -> plan one action -> policy/review -> execute -> verify -> judge`. It does not place model orchestration in the MV3 service worker. Every Agent Run inherits allowed-host and secret-handling constraints, allows one state-changing action per observation, and stops for authentication, CAPTCHA, sensitive targets, or destructive operations.

Use lifecycle operations with the returned `runId`:

```json
{ "operation": "get", "runId": "agent-run-..." }
{ "operation": "resume", "runId": "agent-run-..." }
{ "operation": "cancel", "runId": "agent-run-..." }
```

Resume only after the operator has completed the required authentication or review in the paired browser. A VS Code restart converts an interrupted active run into a resumable `partial` state. Repeated browser fingerprints trigger replanning and eventually an operator handoff instead of unbounded retries.

For direct `runWorkflow` batches, the passive browser executor discards remaining actions when navigation, tab, URL, focus, or relevant DOM state becomes stale. Submit a new observation before planning another write.

## Action Catalog

Smoke-test status is based on the local control page run on 2026-06-06 with Edge demo profile `Profile 1`. Calls below omit common fields such as `captureAfter`, `includeScreenshot`, `investigationName`, and `timeoutMs` unless they are relevant.

| Action | Purpose | Key inputs | Smoke-test status | Smoke-test call |
| --- | --- | --- | --- | --- |
| `readPage` | Return current page state | `captureAfter` | Success | `#browserAct { "action": "readPage", "captureAfter": false }` |
| `capture` | Store current tab capture | `includeScreenshot`, `includeHtml` | Success | `#browserAct { "action": "capture", "captureAfter": true, "includeScreenshot": true }` |
| `navigate` | Navigate active tab | `url`, `acknowledgement` | Success | `#browserAct { "action": "navigate", "url": "http://127.0.0.1:18080/page1", "acknowledgement": "CONFIRM_BROWSER_ACTION" }` |
| `click` | Click by selector/text/label | `selector`, `text`, `label` | Success | `#browserAct { "action": "click", "selector": "#click-target" }` |
| `type` | Type non-secret text | `selector`, `text`, `label`, `value` | Success | `#browserAct { "action": "type", "selector": "#name-input", "value": "Owen Tester" }` |
| `waitForText` | Wait for visible text | `text`, `timeoutMs` | Success | `#browserAct { "action": "waitForText", "text": "READY_MARKER" }` |
| `wait` | Wait for condition | `wait.kind`, `selector`, `text`, `urlPattern` | Success | `#browserAct { "action": "wait", "wait": { "kind": "text", "text": "READY_MARKER" } }` |
| `scroll` | Scroll page | `direction`, `delta` | Success | `#browserAct { "action": "scroll", "direction": "down", "delta": 500 }` |
| `hover` | Hover target | `selector`, `text`, `label` | Success | `#browserAct { "action": "hover", "selector": "#hover-target" }` |
| `keyPress` | Send key events | `key` | Success | `#browserAct { "action": "keyPress", "selector": "#key-input", "key": "Enter" }` |
| `selectOption` | Select option | `selector`, `value`, `options` | Success | `#browserAct { "action": "selectOption", "selector": "#choice", "value": "b" }` |
| `clearInput` | Clear input/textarea | `selector`, `text`, `label` | Success | `#browserAct { "action": "clearInput", "selector": "#notes" }` |
| `back` | Go back in browser history | `timeoutMs` | Success | `#browserAct { "action": "back" }` |
| `forward` | Go forward in browser history | `timeoutMs` | Success | `#browserAct { "action": "forward" }` |
| `reload` | Reload current tab | `timeoutMs` | Success | `#browserAct { "action": "reload" }` |
| `openInNewTab` | Open URL in new tab | `url`, `acknowledgement` | Success | `#browserAct { "action": "openInNewTab", "url": "http://127.0.0.1:18080/page1", "acknowledgement": "CONFIRM_BROWSER_ACTION" }` |
| `switchTab` | Activate tab by index | `targetTabIndex` | Success | `#browserAct { "action": "switchTab", "targetTabIndex": 0 }` |
| `closeTab` | Close tab | `confirmDangerous: true` | Success | `#browserAct { "action": "closeTab", "confirmDangerous": true }` |
| `listInteractables` | Inspect clickable/focusable UI | none | Success | `#browserAct { "action": "listInteractables", "captureAfter": false }` |
| `inspectTargets` | Rank visual/accessibility target candidates | `targetHint`, `text`, `label`, `role` | New | `#browserAct { "action": "inspectTargets", "targetHint": "Evidence tab", "captureAfter": false }` |
| `captureElement` | Capture screenshot clipped to one element | `selector` or `targetHint`, `regionPadding` | New | `#browserAct { "action": "captureElement", "selector": "#event-card", "regionPadding": 8, "captureAfter": true }` |
| `captureRegion` | Capture screenshot clipped to explicit rectangle | `regionX`, `regionY`, `regionWidth`, `regionHeight` | New | `#browserAct { "action": "captureRegion", "regionX": 320, "regionY": 180, "regionWidth": 760, "regionHeight": 420, "captureAfter": true }` |
| `runWorkflow` | Execute multiple steps | `steps`, `preset` | Fails: unserializable script argument | `#browserAct { "action": "runWorkflow", "steps": [{ "action": "readPage" }, { "action": "click", "selector": "#click-target" }] }` |
| `runScenarioTemplate` | Execute a built-in or custom scenario template | `scenarioName`, `params`, `scenarioTemplates` | New | `#browserAct { "action": "runScenarioTemplate", "scenarioName": "portalReadinessCheck", "captureAfter": false }` |
| `listScenarioTemplates` | List built-in and persisted scenario templates | none | New | `#browserAdmin { "action": "listScenarioTemplates" }` |
| `saveScenarioTemplate` | Save a versioned local scenario template | `scenarioName`, `scenarioTemplates`, `templateVersion` | New | `#browserAdmin { "action": "saveScenarioTemplate", "scenarioName": "myCheck", "scenarioTemplates": { "myCheck": { "steps": [{ "action": "readPage" }] } }, "templateVersion": "1.0.0" }` |
| `deleteScenarioTemplate` | Delete a persisted template without affecting built-ins | `scenarioName` | New | `#browserAdmin { "action": "deleteScenarioTemplate", "scenarioName": "myCheck" }` |
| `exportScenarioTemplates` | Export persisted templates as structured JSON | none | New | `#browserAdmin { "action": "exportScenarioTemplates" }` |
| `journeyCapture` | Visit URL list and collect summaries | `urls`, `maxPages`, `extractSelectors` | Success | `#browserAct { "action": "journeyCapture", "urls": ["http://127.0.0.1:18080/page1", "http://127.0.0.1:18080/page2"], "maxPages": 2, "extractSelectors": { "ready": "#ready-text" }, "acknowledgement": "CONFIRM_BROWSER_ACTION" }` |
| `paginateCapture` | Follow next-page controls | `nextSelector`, `nextText`, `maxPages` | Success | `#browserAct { "action": "paginateCapture", "nextSelector": "#next-page", "maxPages": 2, "extractSelectors": { "ready": "#ready-text" } }` |
| `smartFormFill` | Fill form fields by label/name/placeholder | `formFields`, `submitSelector`, `submitText` | Success | `#browserAct { "action": "smartFormFill", "formFields": { "Name": "Smart Fill", "Notes": "Smart notes" }, "submitSelector": "#submit-form" }` |
| `conditionalWorkflow` | Branch based on page state | `conditions` | Success | `#browserAct { "action": "conditionalWorkflow", "conditions": [{ "if": { "text": "READY_MARKER" }, "then": [{ "action": "click", "selector": "#click-target" }] }] }` |
| `multiTabCrawl` | Open matched links in background tabs | `linkSelector`, `linkText`, `maxTabs` | Fails: unserializable script argument | `#browserAct { "action": "multiTabCrawl", "linkSelector": ".crawl-link", "maxTabs": 2 }` |
| `runtimeSnapshot` | Return resources, navigation timing, paint, LCP, CLS, and long-task metrics | none | Success | `#browserRead { "action": "runtimeSnapshot" }` |
| `domDiffTimeline` | Run steps and compare DOM fingerprints | `steps` | Success | `#browserAct { "action": "domDiffTimeline", "steps": [{ "action": "click", "selector": "#click-target" }, { "action": "type", "selector": "#name-input", "value": "Diff Test" }] }` |
| `ocrSnapshot` | Return screenshot and DOM text hints | none | Success | `#browserAct { "action": "ocrSnapshot" }` |
| `dataGapGuard` | Check required fields/texts | `requiredFields`, `requiredTexts`, `extractSelectors` | Success | `#browserAct { "action": "dataGapGuard", "requiredFields": ["ready"], "requiredTexts": ["READY_MARKER"], "extractSelectors": { "ready": "#ready-text" } }` |
| `exportReplay` | Return last replay script | none | Success | `#browserAct { "action": "exportReplay" }` |
| `networkTraceCapture` | Return resource timing trace | `urlIncludes`, `maxEntries` | Success | `#browserAct { "action": "networkTraceCapture", "urlIncludes": ["api"], "maxEntries": 20 }` |
| `safeDownloadAndHash` | Fetch file URL and SHA-256 hash it | `selector`, `text`, `url` | Success with explicit empty optional fields; omission currently fails | `#browserAct { "action": "safeDownloadAndHash", "selector": "", "text": "", "url": "http://127.0.0.1:18080/download.txt" }` |
| `tableExtract` | Extract table rows as JSON/CSV | `tableSelector`, `headerMode`, `outputFormat` | Success | `#browserAct { "action": "tableExtract", "tableSelector": "#data-table", "headerMode": "auto", "outputFormat": "json" }` |
| `stateCheckpoint` | Save URL, scroll, and optional form state | `checkpointName`, `includeFormState` | Success | `#browserAct { "action": "stateCheckpoint", "checkpointName": "before-change", "includeFormState": true }` |
| `rollbackToCheckpoint` | Restore a saved checkpoint | `checkpointName`, `strictUrlMatch` | Success | `#browserAct { "action": "rollbackToCheckpoint", "checkpointName": "before-change", "strictUrlMatch": false }` |
| `humanReviewGate` | Pause until explicit keyword approval | `reviewPrompt`, `approvalKeyword`, `value` | Success for approved path | `#browserAct { "action": "humanReviewGate", "reviewPrompt": "Approve smoke test gate", "approvalKeyword": "APPROVE_SMOKE", "value": "APPROVE_SMOKE" }` |
| `bulkActionFromList` | Apply click/hover to matched list items | `itemSelector`, `matchText`, `matchMode`, `actionTemplate` | Success | `#browserAct { "action": "bulkActionFromList", "itemSelector": ".bulk-item", "matchText": "High", "matchMode": "includes", "actionTemplate": { "action": "hover" }, "maxItems": 2 }` |
| `semanticWait` | Wait for semantic page conditions | `semanticConditions` | Success | `#browserAct { "action": "semanticWait", "semanticConditions": ["text:READY_MARKER", "selector:#data-table"] }` |
| `compareCaptureRuns` | Compare two recent action runs | `baseRunId`, `newRunId`, `ignoreSelectors` | Success | `#browserAct { "action": "compareCaptureRuns" }` |
| `policyGuard` | Check host/action policy before proceeding | `policyProfile`, `onViolation`, `actionTemplate` | Success | `#browserAct { "action": "policyGuard", "policyProfile": "standard", "onViolation": "block", "actionTemplate": { "action": "click" } }` |
| `visualAssert` | Assert current visual/page state | `assertText`, `assertNoText`, `assertSelector`, `assertNotSelector`, `assertScreenshotChanged` | New | `#browserAct { "action": "visualAssert", "assertText": "READY_MARKER", "assertSelector": "#data-table", "captureAfter": false }` |
| `accessibilitySnapshot` | Inspect role/name-oriented page structure | `maxEntries` | New | `#browserAct { "action": "accessibilitySnapshot", "maxEntries": 80, "captureAfter": false }` |
| `mapForm` | Return form field schema before filling | `selector`, `maxEntries` | New | `#browserAct { "action": "mapForm", "captureAfter": false }` |
| `watchPageChanges` | Observe short-window DOM, URL, text, and resource changes | `watchDurationMs` | New | `#browserAct { "action": "watchPageChanges", "watchDurationMs": 2500, "captureAfter": false }` |
| `highlightEvidence` | Store highlighted screenshot evidence | `highlightSelectors`, `highlightText`, `selector` | New | `#browserAct { "action": "highlightEvidence", "highlightSelectors": ["#data-table"], "captureAfter": true, "includeScreenshot": true }` |
| `planAndRun` | Generate and run a guarded workflow from a goal | `goal`, `steps`, `waitPreset`, `contractSelectors` | New | `#browserAct { "action": "planAndRun", "goal": "verify the evidence table", "tableSelector": "#data-table", "captureAfter": false }` |
| `evidenceClaimCheck` | Check a report claim against visible page/table evidence | `claim`, `tableSelector` | New | `#browserAct { "action": "evidenceClaimCheck", "claim": "Alpha is Open", "tableSelector": "#data-table" }` |
| `tableWatchAndDiff` | Watch a table and return row-level diff | `tableSelector`, `keyColumns`, `watchDurationMs` | New | `#browserAct { "action": "tableWatchAndDiff", "tableSelector": "#data-table", "keyColumns": ["Name"], "watchDurationMs": 1500 }` |
| `browserRunBundle` | Assemble a capture-group run bundle | `captureGroup` | New | `#browserAct { "action": "browserRunBundle", "captureGroup": "case-001", "captureAfter": false }` |
| `safeActionPreview` | Preview target and risk before acting | `actionTemplate`, `targetHint`, `selector`, `text` | New | `#browserAct { "action": "safeActionPreview", "actionTemplate": { "action": "click", "targetHint": "Evidence" } }` |
| `stableTargetProfile` | Rank stable selector/accessibility candidates | `targetHint`, `selector`, `text`, `label` | New | `#browserAct { "action": "stableTargetProfile", "targetHint": "Evidence", "captureAfter": false }` |
| `guidedDrilldown` | Open matching rows and collect detail text | `tableSelector`, `itemSelector`, `matchText`, `detailSelector` | New | `#browserAct { "action": "guidedDrilldown", "tableSelector": "#data-table", "matchText": "High", "detailSelector": "#details" }` |
| `evidenceCompletenessCheck` | Check capture-group coverage for required claims | `captureGroup`, `requiredClaims` | New | `#browserAct { "action": "evidenceCompletenessCheck", "captureGroup": "case-001", "requiredClaims": ["severity"] }` |
| `failureExplainer` | Explain the latest or selected failed run | `baseRunId`, `targetHint` | New | `#browserAct { "action": "failureExplainer", "captureAfter": false }` |
| `waitProfiler` | Compare wait strategies on the current page | `waitCandidates`, `selector`, `semanticConditions` | New | `#browserAct { "action": "waitProfiler", "waitCandidates": ["spinnerGone", "elementStable"], "selector": "#data-table" }` |
| `automationHealthScore` | Score current page readiness for automation | none | New | `#browserAct { "action": "automationHealthScore", "captureAfter": false }` |
| `sensitiveActionGuard` | Block/warn before destructive actions | `actionTemplate`, `targetHint`, `onViolation` | New | `#browserAct { "action": "sensitiveActionGuard", "actionTemplate": { "action": "click", "targetHint": "Delete" } }` |
| `tabOrchestrator` | Classify tabs by role, flag unexpected tabs, and optionally return/clean up | `tabRoles`, `expectedTabs`, `returnToRole`, `onUnexpectedTab` | New | `#browserAct { "action": "tabOrchestrator", "tabRoles": { "main": ["admin.microsoft.com"], "auth": ["login"] }, "expectedTabs": 2, "returnToRole": "main" }` |
| `popupGuard` | Warn or block on unexpected/auth/permission/security tabs | `expectedTabs`, `onUnexpectedTab`, `tabRoles` | New | `#browserAct { "action": "popupGuard", "expectedTabs": 1, "onUnexpectedTab": "warn", "captureAfter": false }` |
| `returnToTab` | Reactivate a tab by logical role or tab index | `returnToRole`, `targetTabIndex`, `tabRoles` | New | `#browserAct { "action": "returnToTab", "returnToRole": "main", "tabRoles": { "main": ["admin.microsoft.com"] } }` |
| `tabRunSummary` | Summarize current-window tab roles, signals, and next action | `tabRoles`, `expectedTabs` | New | `#browserAct { "action": "tabRunSummary", "captureAfter": false }` |
| `waitPreset` | Wait for named portal readiness conditions | `waitPreset` | New | `#browserAct { "action": "waitPreset", "waitPreset": "genericPortalReady", "captureAfter": false }` |
| `assertPageContract` | Verify expected page selectors/texts | `contractName`, `contractSelectors`, `contractTexts` | New | `#browserAct { "action": "assertPageContract", "contractSelectors": ["#data-table"], "contractTexts": ["READY_MARKER"] }` |
| `buildEvidencePack` | Write capture-group evidence pack files | `captureGroup` | New | `#browserAct { "action": "buildEvidencePack", "captureGroup": "case-001", "captureAfter": false }` |
| `buildNavigationGraph` | Write recent action-flow graph files | `maxEntries` | New | `#browserAct { "action": "buildNavigationGraph", "maxEntries": 80, "captureAfter": false }` |
| `createHandoff` | Summarize current state for manual continuation | `reviewPrompt`, `targetHint` | New | `#browserAct { "action": "createHandoff", "reviewPrompt": "Need manual review" }` |
| `selectorHealthReport` | Report remembered selector health | none | New | `#browserAct { "action": "selectorHealthReport", "captureAfter": false }` |
| `captureReviewQueue` | List runs that need review | `maxEntries` | New | `#browserAct { "action": "captureReviewQueue", "maxEntries": 50 }` |
| `startBrowserJob` | Run named step bundle and store job status | `jobName`, `steps` | New | `#browserAct { "action": "startBrowserJob", "jobName": "smoke", "steps": [{ "action": "readPage" }] }` |
| `getBrowserJob` | Read stored job status | `jobName` | New | `#browserAct { "action": "getBrowserJob", "jobName": "smoke" }` |
| `cancelBrowserJob` | Mark stored job cancelled | `jobName` | New | `#browserAct { "action": "cancelBrowserJob", "jobName": "smoke" }` |
| `resumeAfterAuth` | Continue after manual sign-in | none | Conditional: only valid after `AUTH_REQUIRED`; no pending auth in smoke test | `#browserAct { "action": "resumeAfterAuth" }` |

## Wait Conditions

Supported `wait.kind` values:

| kind | Meaning |
|---|---|
| `text` | Page body includes text |
| `element` | Selector is visible |
| `elementGone` | Selector is gone or hidden |
| `urlMatch` | Current URL includes or matches pattern |
| `spinnerGone` | Common busy/progress indicators disappear |
| `elementStable` | Element text is stable across checks |
| `urlSettled` | URL stops changing |
| `composite` | Spinner gone and optional selector visible |
| `semantic` | All semantic expressions pass |
| `networkIdle` | Resource activity is unchanged for `idleMs` |
| `requestDone` | Matching resource entries are observed (`urlIncludes`) |

`requestDone` currently uses `PerformanceResourceTiming` evidence. `statusIn` can be passed for forward compatibility but is not enforced in MV3 runtime.

## New Targeting And Replay Features

Use these inputs with `#browserAct` for higher reliability on modern web apps:

| Input | Purpose |
|---|---|
| `targetScope` | Target lookup scope: `auto`, `main`, `allFrames`, `shadowDeep` |
| `frameDepth` | Max same-origin iframe traversal depth |
| `retryProfile` | Retry preset: `conservative`, `standard`, `aggressive` |
| `selectorMemory` | Enables or disables host/intent selector memory reuse |
| `captureBeforeAfter` | Adds lightweight before/after DOM diff metadata |
| `macroName` | Macro identifier for `recordWorkflow` and `replayWorkflow` |
| `params` | Template values for replay and scenario templates (`{{key}}`) |
| `scenarioName` | Built-in or custom scenario template name for `runScenarioTemplate` |
| `scenarioTemplates` | Optional custom template registry with defaults and steps |
| `templateVersion` | Version stored with `saveScenarioTemplate` |
| `effectPolicy` | Post-action effect handling: `none`, `observe`, `require` |
| `goal` | Natural-language goal for `planAndRun` |
| `claim` | Report statement checked by `evidenceClaimCheck` |
| `requiredClaims` | Required claim/category list for `evidenceCompletenessCheck` |
| `keyColumns` | Stable row-key columns for `tableWatchAndDiff` |
| `waitCandidates` | Wait condition names profiled by `waitProfiler` |
| `detailSelector` | Detail panel selector for `guidedDrilldown` |
| `waitPreset` | Named readiness preset: `genericPortalReady`, `defenderIncidentReady`, `azureBladeReady`, `entraTableReady` |
| `contractName` | Named contract for `assertPageContract` |
| `contractSelectors` | Selectors that must be visible |
| `contractTexts` | Text snippets that must be present |
| `captureGroup` | Group or host/group path for evidence pack generation |
| `jobName` | Stored browser job identifier |
| `tabRoles` | Role-to-URL/title substring map for tab orchestration |
| `expectedTabs` | Expected current-window tab count for popup detection |
| `returnToRole` | Logical role to reactivate with `returnToTab` or `tabOrchestrator` |
| `closeExtraTabs` | Close unexpected inactive tabs; requires `confirmDangerous: true` |
| `onUnexpectedTab` | Handling mode: `capture`, `warn`, or `block` |

Use `visualAssert` after click/type/navigation steps when the important question is whether the UI actually reached the expected state. Prefer `assertText` plus `assertSelector` for portal pages where a click can succeed without changing the active blade or table.

Selector memory is enabled by default. When auto-heal or a remembered selector succeeds for the same host and target intent, later actions try that remembered target before ordinary fallback selectors. Set `selectorMemory: false` on a step when testing a brand-new selector path.

For debugging, run `Owen Browser Bridge: Show Action Trace` in VS Code. It opens a compact Markdown table from the latest `_action-logs/browser-actions-*.jsonl` file, including command ids, actions, step counts, diff metadata, and stored capture links.

Captured JSON and Markdown are redacted before storage. Use `owenBrowserBridge.redactionProfile` (`off`, `standard`, `strict`) and `owenBrowserBridge.customRedactionPatterns` for site-specific sensitive strings. PNG capture redaction is configured separately in the browser popup and defaults to `standard`; `strict` also masks all input-like fields and visible email, IP, and GUID values. The pairing token is stored in browser-local storage, not browser-sync storage. Do not commit raw captures or screenshots.

New actions:

| Action | Purpose | Key inputs |
|---|---|---|
| `accessibilitySnapshot` | Return compact role/name/selector/bounds structure for choosing stable targets | `maxEntries` |
| `mapForm` | Return field labels, names, types, required state, options, and selector hints | `selector`, `maxEntries` |
| `watchPageChanges` | Observe mutation count, URL/title/text deltas, and new resource timings | `watchDurationMs` |
| `highlightEvidence` | Create a screenshot with labeled boxes around important visible targets | `highlightSelectors`, `highlightText`, `selector` |
| `planAndRun` | Turn a goal into a guarded sequence of readiness, contract, table, highlight, and explicit steps | `goal`, `steps` |
| `evidenceClaimCheck` | Return supported/not-enough-evidence verdict with matching terms, snippets, and table rows | `claim`, `tableSelector` |
| `tableWatchAndDiff` | Compare two table snapshots and report added, removed, and changed rows | `tableSelector`, `keyColumns`, `watchDurationMs` |
| `browserRunBundle` | Create `_run-bundles/<id>/` with manifest, README, action logs, and capture references | `captureGroup` |
| `safeActionPreview` | Show the element that would be acted on and whether confirmation is needed | `actionTemplate`, `targetHint` |
| `stableTargetProfile` | Score target candidates by selector strength, accessibility name, and interactability | `targetHint`, `selector`, `text`, `label` |
| `guidedDrilldown` | Click matching table/list rows and collect detail panel evidence | `tableSelector`, `itemSelector`, `matchText`, `detailSelector` |
| `evidenceCompletenessCheck` | Write `_evidence-completeness.md/json` when a capture group is available | `captureGroup`, `requiredClaims` |
| `failureExplainer` | Classify recent failures and recommend retry or inspection actions | `baseRunId`, `targetHint` |
| `waitProfiler` | Measure candidate wait conditions and recommend a readiness strategy | `waitCandidates`, `selector`, `semanticConditions` |
| `automationHealthScore` | Score auth/loading/DOM stability/interactable/selector-memory readiness | none |
| `sensitiveActionGuard` | Detect destructive action text and return pass/warn/block decision | `actionTemplate`, `onViolation` |
| `tabOrchestrator` | Classify tabs by logical role and return to the right work tab | `tabRoles`, `expectedTabs`, `returnToRole` |
| `popupGuard` | Warn/block when unexpected, auth, permission, or security tabs appear | `expectedTabs`, `onUnexpectedTab` |
| `returnToTab` | Reactivate the requested role or tab index | `returnToRole`, `targetTabIndex` |
| `tabRunSummary` | Return role counts, signals, unexpected tabs, and next action | `tabRoles`, `expectedTabs` |
| `waitPreset` | Run a named readiness wait and contract check | `waitPreset` |
| `assertPageContract` | Check page selectors/texts or named portal contracts | `contractName`, `contractSelectors`, `contractTexts` |
| `buildEvidencePack` | Assemble `_evidence-pack.md` and `_evidence-pack.json` in a capture group | `captureGroup` |
| `buildNavigationGraph` | Create `_navigation-graphs/*.md` and `*.json` from recent action history | `maxEntries` |
| `createHandoff` | Create a manual handoff report with latest run and candidate targets | `reviewPrompt`, `targetHint` |
| `selectorHealthReport` | Export remembered selector usage summary | none |
| `captureReviewQueue` | Export runs with failed steps or quality findings | `maxEntries` |
| `startBrowserJob` / `getBrowserJob` / `cancelBrowserJob` | Manage a persisted stepwise job that accepts cancellation between steps | `jobName`, `steps` |
| `recordWorkflow` | Save reusable workflow steps in browser local storage | `macroName`, `steps` |
| `replayWorkflow` | Replay a saved workflow with optional template parameters | `macroName`, `params`, `captureBeforeAfter` |
| `runScenarioTemplate` | Run a reusable browser scenario from generic or Microsoft Security template registries | `scenarioName`, `params`, `scenarioTemplates` |
| `listScenarioTemplates` / `saveScenarioTemplate` / `deleteScenarioTemplate` / `exportScenarioTemplates` | Manage persisted versioned scenario templates | `scenarioName`, `scenarioTemplates`, `templateVersion` |

## Scenario Templates

Use `runScenarioTemplate` when the task is a repeatable browser scenario rather than a single action. Built-in templates render `{{key}}` placeholders from `params` and top-level inputs such as `captureGroup`, `tableSelector`, `requiredClaims`, `tabRoles`, and `actionTemplate`.

```text
#browserAct { "action": "runScenarioTemplate", "scenarioName": "portalReadinessCheck", "params": { "contractName": "genericPortalReady" }, "captureAfter": false }
#browserAct { "action": "runScenarioTemplate", "scenarioName": "evidenceTableReview", "tableSelector": "#data-table", "claim": "Alpha is Open", "captureGroup": "case-001" }
```

| Template | Purpose | Main actions |
|---|---|---|
| `portalReadinessCheck` | Check whether a portal page is ready for automation | `automationHealthScore`, `waitPreset`, `assertPageContract`, `accessibilitySnapshot` |
| `evidenceTableReview` | Extract and verify table evidence | `tableExtract`, `highlightEvidence`, `evidenceClaimCheck`, `buildEvidencePack` |
| `safeDestructiveAction` | Preview and gate potentially destructive actions | `policyGuard`, `sensitiveActionGuard`, `safeActionPreview`, `humanReviewGate` |
| `multiTabAuthFlow` | Manage auth, callback, popup, and main tabs | `tabRunSummary`, `popupGuard`, `tabOrchestrator`, `returnToTab` |
| `formFillAndVerify` | Map, fill, watch, and assert form outcomes | `mapForm`, `smartFormFill`, `watchPageChanges`, `visualAssert` |
| `downloadEvidenceCapture` | Capture and hash download evidence | `highlightEvidence`, `safeDownloadAndHash`, `browserRunBundle` |
| `flakyUiRecovery` | Explain failures and choose better waits or targets | `failureExplainer`, `waitProfiler`, `stableTargetProfile`, `safeActionPreview` |
| `guidedDrilldownEvidence` | Open row/list details and check evidence coverage | `tableExtract`, `guidedDrilldown`, `highlightEvidence`, `evidenceCompletenessCheck` |
| `operatorHandoff` | Package state for a human operator | `createHandoff`, `buildNavigationGraph`, `browserRunBundle`, `captureReviewQueue` |
| `backgroundJobWorkflow` | Run a named step bundle as a browser job | `startBrowserJob`, `getBrowserJob`, `browserRunBundle` |

## Microsoft Security Scenario Templates

These templates are read-oriented by default. Remediation-like actions are guarded with preview, policy, sensitive-action, or handoff steps instead of direct clicks.

```text
#browserAct { "action": "runScenarioTemplate", "scenarioName": "defenderXdrIncidentTriage", "captureGroup": "defender-incident-12345", "params": { "alertsTableSelector": "table", "summarySelector": "main" }, "captureAfter": false }
#browserAct { "action": "runScenarioTemplate", "scenarioName": "sentinelLogCollection", "captureGroup": "sentinel-log-case-001", "tableSelector": "table", "captureAfter": false }
```

| Template | Product | Purpose |
|---|---|---|
| `defenderXdrIncidentTriage` | Microsoft Defender XDR | Incident summary, severity, related alerts, entities, timeline evidence, and handoff pack |
| `defenderXdrAlertEvidenceReview` | Microsoft Defender XDR | Per-alert detection evidence and impact review |
| `sentinelLogCollection` | Microsoft Sentinel | KQL result table and query-context evidence capture |
| `sentinelIncidentCorrelation` | Microsoft Sentinel | Correlate Sentinel incident evidence with visible log results |
| `entraRiskySignInReview` | Microsoft Entra ID | Risky sign-in evidence with guarded remediation review |
| `entraAuditTrailCapture` | Microsoft Entra ID | Audit/sign-in log filter and table evidence capture |
| `mdeDeviceTimelineReview` | Defender for Endpoint | Device timeline event and detail evidence review |
| `mdeAdvancedHuntingCollection` | Defender XDR Advanced Hunting | Advanced Hunting result collection and claim check |
| `mdoEmailThreatReview` | Defender for Office 365 | Email threat, URL, attachment, and delivery evidence review |
| `defenderForIdentityLateralMovementReview` | Defender for Identity | Account and host evidence for lateral movement alerts |
| `defenderForCloudPostureReview` | Defender for Cloud | Recommendation, resource, severity, and compliance posture evidence |
| `purviewDlpIncidentReview` | Microsoft Purview | DLP alert, policy, and sensitive information evidence capture |
| `securityPortalHandoffBundle` | Microsoft Security portals | Cross-product evidence pack, navigation graph, and review queue handoff |

Prefer `accessibilitySnapshot` before uncertain clicks and `mapForm` before `smartFormFill`. Use `watchPageChanges` after manual sign-in, navigation, or portal blade changes when the page may still be settling. Use `highlightEvidence` for screenshots that need to show exactly which table, panel, or status marker supports the conclusion.

Use `waitPreset` before portal-specific evidence collection, then `assertPageContract` before extracting tables or summarizing visible evidence. After collecting multiple captures, call `buildEvidencePack` and `buildNavigationGraph` so downstream analysis can correlate action flow, captures, and screenshots. Use `createHandoff` when automation reaches a point where the operator should continue manually.

Use `planAndRun` when the user gives a goal rather than exact selectors, but keep `captureAfter: false` until the generated steps are known to be useful. Use `evidenceClaimCheck` before writing final report claims. Use `tableWatchAndDiff` for portal grids that refresh in place, and `browserRunBundle` at handoff time after captures and evidence packs exist.

Use `safeActionPreview` before destructive or ambiguous clicks, then `stableTargetProfile` when a target needs a durable selector. Use `guidedDrilldown` for table-to-detail workflows. Run `evidenceCompletenessCheck` before final handoff to identify missing report claims.

Use `automationHealthScore` before long workflows, `waitProfiler` when portal readiness is flaky, `sensitiveActionGuard` before any action with delete/remove/disable/approve-like language, and `failureExplainer` immediately after a failed action before changing selectors. Use `tabRunSummary`, `tabOrchestrator`, `popupGuard`, and `returnToTab` around OAuth, download, multi-portal, or popup-heavy workflows.

Semantic expressions for `semanticWait` or `wait.kind=semantic`:

| Expression | Meaning |
|---|---|
| `text:<value>` | Page contains text |
| `notText:<value>` | Page does not contain text |
| `selector:<css>` | Selector is visible |
| `selectorGone:<css>` | Selector is gone or hidden |

Example:

```text
#browserAct { "action": "semanticWait", "semanticConditions": ["notText:Loading", "selector:[role='tab']"], "timeoutMs": 60000 } wait until the portal page is ready, then summarize what changed.
```

## Authentication Flow

If the browser reaches a sign-in page, the bridge returns `AUTH_REQUIRED` and stores a resume input.

Agent behavior:

1. Stop automation.
2. Tell the user to complete sign-in in the browser.
3. Wait until the user says authentication is done.
4. Call:

```text
#browserAct { "action": "resumeAfterAuth" } continue the paused browser workflow.
```

Never request passwords, MFA codes, tokens, or cookies in chat.

## Safety Rules for Agents

Follow these rules every time:

1. Stay within allowed hosts.
2. Do not type into password fields.
3. Do not handle secrets in chat.
4. Ask for explicit confirmation before destructive or high-impact actions.
5. Use `humanReviewGate` before bulk actions, downloads, tab closing, or policy-changing UI operations.
6. Prefer `captureAfter: true` for evidence-producing work.
7. Use `investigationName` to group related captures.
8. Report visible evidence separately from inference.

## Common Recipes

### Capture the Current Page

```text
#browserAct { "action": "capture", "captureAfter": true, "includeScreenshot": true, "investigationName": "case-001" } analyze the current page as evidence.
```

### Navigate and Capture

```text
#browserAct { "action": "navigate", "url": "https://security.microsoft.com", "acknowledgement": "CONFIRM_BROWSER_ACTION", "captureAfter": true, "includeScreenshot": true, "investigationName": "case-001" } open the portal and summarize the visible state.
```

### Inspect Available Targets Before Clicking

```text
#browserAct { "action": "listInteractables", "captureAfter": false } list likely selectors/text labels for the next action.
```

### Click With Fallbacks

```text
#browserAct { "action": "click", "text": "Evidence", "fallbackTexts": ["Assets", "Entities"], "retries": 2, "captureAfter": true, "investigationName": "incident-12345" } open the most relevant investigation tab and report the result.
```

### Inspect And Auto-Heal Targets

```text
#browserAct { "action": "inspectTargets", "targetHint": "Evidence tab", "captureAfter": false } rank likely browser targets before choosing a click selector.
```

```text
#browserAct { "action": "click", "targetHint": "Evidence tab", "autoHeal": true, "captureAfter": true, "investigationName": "incident-12345" } click the best matching target and report whether auto-healing was used.
```

### Capture Only One Panel Or Box

```text
#browserAct { "action": "captureElement", "targetHint": "Process Name", "regionPadding": 10, "captureAfter": true, "includeScreenshot": true, "investigationName": "incident-12345" } capture only the process panel as evidence and include its bounds.
```

```text
#browserAct { "action": "captureRegion", "regionX": 320, "regionY": 180, "regionWidth": 760, "regionHeight": 420, "captureAfter": true, "includeScreenshot": true, "investigationName": "incident-12345" } capture only this rectangle area and summarize what is visible.
```

### Check Capture Quality

After `readPage` or `capture`, inspect `screenSummary.captureQuality`. Treat `level=poor`, `auth-page-likely`, `loading-indicator-visible`, or `low-visible-text` as evidence gaps and wait, re-capture, or ask the operator to finish sign-in before analysis.

### Extract a Table

```text
#browserAct { "action": "tableExtract", "tableSelector": "table", "headerMode": "auto", "outputFormat": "json", "captureAfter": true, "investigationName": "incident-12345" } extract the table and identify missing or suspicious rows.
```

### Save and Restore a Checkpoint

```text
#browserAct { "action": "stateCheckpoint", "checkpointName": "before-filter-change", "includeFormState": true, "captureAfter": false } save this state before changing filters.
```

```text
#browserAct { "action": "rollbackToCheckpoint", "checkpointName": "before-filter-change", "strictUrlMatch": false, "captureAfter": true } restore the checkpoint and confirm the page state.
```

### Guard a Bulk Action

```text
#browserAct { "action": "humanReviewGate", "reviewPrompt": "Confirm before clicking all matching rows", "approvalKeyword": "APPROVE_BULK_CLICK", "value": "APPROVE_BULK_CLICK", "captureAfter": false } verify the operator approved the bulk step.
```

```text
#browserAct { "action": "bulkActionFromList", "itemSelector": "[role='row']", "matchText": "High", "matchMode": "includes", "actionTemplate": { "action": "click" }, "maxItems": 10, "captureAfter": true, "investigationName": "incident-12345" } process the matching high-severity rows and summarize the result.
```

### Network Trace Snapshot

```text
#browserAct { "action": "networkTraceCapture", "urlIncludes": ["api", "security"], "maxEntries": 50, "captureAfter": false } summarize slow or failed-looking resource activity from the current page.
```

## Result Handling

A successful call returns a command object plus completion data. Agents should inspect:

| Field | Meaning |
|---|---|
| `completion.ok` | Whether the browser action completed |
| `completion.error` | Error code/message if not completed |
| `completion.result` | Action-specific structured result |
| `completion.storedCapture` | Stored capture metadata when capture was written |
| `completion.storedCapture.markdownPath` | Markdown evidence file |
| `completion.storedCapture.jsonPath` | Raw JSON evidence file |
| `completion.storedCapture.screenshotPath` | Screenshot path when present |

If a capture is stored, prefer analyzing the Markdown plus adjacent JSON. Use screenshot paths for visual confirmation when needed.

`completion.storedCapture.integrityPath` points to the SHA-256 manifest for the redacted JSON, Markdown, and optional PNG artifacts. Use it when evidence integrity or handoff verification matters. Captures are also available in the VS Code **Browser Captures** Explorer grouped by host and investigation.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Tool is unavailable | Tool name differs by host | Try `#browserAct`, `#browser_act`, or inspect available tools |
| `unauthorized` | Pairing token mismatch | Copy token from VS Code setup page and paste into browser extension |
| `host_not_allowed` | URL host not in allowed list | Add host in setup page or VS Code settings |
| Multiple browser agents | More than one active agent and no target selected | Pass `targetAgentId` or set `owenBrowserBridge.preferredAgentId` |
| Another VS Code window owns port `17321` | A second extension host shares the same bridge port | No action needed; secondary windows proxy to the owner and take over after it closes |
| Command times out | Browser extension polling disabled, Edge opened an unpaired profile, or tab hung | Enable browser actions, pair the active Edge profile once, reload the extension, then retry |
| `AUTH_REQUIRED` | Portal redirected to sign-in | User completes sign-in, then call `resumeAfterAuth` |
| `REVIEW_REQUIRED` | Manual gate not approved | Re-run with the expected `approvalKeyword` in `value` after operator approval |
| Empty extraction | Selector mismatch or SPA not ready | Run `listInteractables`, `semanticWait`, then retry |

## Minimal Agent Policy

When in doubt, use this policy:

1. Read/capture first.
2. List interactables before uncertain clicks.
3. Use waits after navigation or SPA transitions.
4. Save checkpoints before changing filters or form state.
5. Ask for user confirmation before bulk or destructive operations.
6. Keep evidence paths in the final answer.
