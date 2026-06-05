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
| `#getLatestBrowserCapture` | Read the latest capture |
| `#readBrowserCapture` | Read one capture by id/path |
| `#readBrowserCaptureGroup` | Read all captures in a host or investigation group |

Some agent hosts may expose the underlying tool id as `browser_act`. If `#browserAct` is unavailable, try `#browser_act` or inspect the available tool list.

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

The `/commands/enqueue` response includes the queued command and completion result. Browser actions are executed by the paired browser extension through polling.

Do not ask the user to paste the pairing token into chat. If a token is required and not already available to the calling environment, ask the user to enter it directly in the browser extension or VS Code setup UI.

## Core Action Pattern

Use this shape for most calls:

```json
{
  "action": "<actionName>",
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

## Action Catalog

| Action | Purpose | Key inputs |
|---|---|---|
| `readPage` | Return current page state | `captureAfter` |
| `capture` | Store current tab capture | `includeScreenshot`, `includeHtml` |
| `navigate` | Navigate active tab | `url`, `acknowledgement` |
| `click` | Click by selector/text/label | `selector`, `text`, `label` |
| `type` | Type non-secret text | `selector`, `text`, `label`, `value` |
| `waitForText` | Wait for visible text | `text`, `timeoutMs` |
| `wait` | Wait for condition | `wait.kind`, `selector`, `text`, `urlPattern` |
| `scroll` | Scroll page | `direction`, `delta` |
| `hover` | Hover target | `selector`, `text`, `label` |
| `keyPress` | Send key events | `key` |
| `selectOption` | Select option | `selector`, `value`, `options` |
| `clearInput` | Clear input/textarea | `selector`, `text`, `label` |
| `back`, `forward`, `reload` | Browser history controls | `timeoutMs` |
| `openInNewTab` | Open URL in new tab | `url`, `acknowledgement` |
| `switchTab` | Activate tab by index | `targetTabIndex` |
| `closeTab` | Close tab | `confirmDangerous: true` |
| `listInteractables` | Inspect clickable/focusable UI | none |
| `runWorkflow` | Execute multiple steps | `steps`, `preset` |
| `journeyCapture` | Visit URL list and collect summaries | `urls`, `maxPages`, `extractSelectors` |
| `paginateCapture` | Follow next-page controls | `nextSelector`, `nextText`, `maxPages` |
| `smartFormFill` | Fill form fields by label/name/placeholder | `formFields`, `submitSelector`, `submitText` |
| `conditionalWorkflow` | Branch based on page state | `conditions` |
| `multiTabCrawl` | Open matched links in background tabs | `linkSelector`, `linkText`, `maxTabs` |
| `runtimeSnapshot` | Return performance/resource hints | none |
| `domDiffTimeline` | Run steps and compare DOM fingerprints | `steps` |
| `ocrSnapshot` | Return screenshot and DOM text hints | none |
| `dataGapGuard` | Check required fields/texts | `requiredFields`, `requiredTexts`, `extractSelectors` |
| `exportReplay` | Return last replay script | none |
| `networkTraceCapture` | Return resource timing trace | `urlIncludes`, `maxEntries` |
| `safeDownloadAndHash` | Fetch file URL and SHA-256 hash it | `selector`, `text`, `url` |
| `tableExtract` | Extract table rows as JSON/CSV | `tableSelector`, `headerMode`, `outputFormat` |
| `stateCheckpoint` | Save URL, scroll, and optional form state | `checkpointName`, `includeFormState` |
| `rollbackToCheckpoint` | Restore a saved checkpoint | `checkpointName`, `strictUrlMatch` |
| `humanReviewGate` | Pause until explicit keyword approval | `reviewPrompt`, `approvalKeyword`, `value` |
| `bulkActionFromList` | Apply click/hover to matched list items | `itemSelector`, `matchText`, `matchMode`, `actionTemplate` |
| `semanticWait` | Wait for semantic page conditions | `semanticConditions` |
| `compareCaptureRuns` | Compare two recent action runs | `baseRunId`, `newRunId`, `ignoreSelectors` |
| `policyGuard` | Check host/action policy before proceeding | `policyProfile`, `onViolation`, `actionTemplate` |
| `resumeAfterAuth` | Continue after manual sign-in | none |

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

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Tool is unavailable | Tool name differs by host | Try `#browserAct`, `#browser_act`, or inspect available tools |
| `unauthorized` | Pairing token mismatch | Copy token from VS Code setup page and paste into browser extension |
| `host_not_allowed` | URL host not in allowed list | Add host in setup page or VS Code settings |
| Command times out | Browser extension polling disabled or tab hung | Enable browser actions, reload extension, retry with larger `timeoutMs` |
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
