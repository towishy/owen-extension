# Change Log

All notable changes to the "owen-browser-bridge" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

## [0.1.32] - 2026-07-20

- Prevented multi-window `EADDRINUSE` activation failures by sharing one localhost bridge owner across VS Code windows.
- Added health-monitored bridge ownership takeover after the owner window closes and routed secondary-window browser actions through the shared command endpoint.
- Added authenticated shared browser-state lookup so secondary windows do not keep reporting stale tab state.

## [0.1.31] - 2026-07-17

- Restored permanent browser host access for passive-agent capture and removed the per-site permission button, runtime gate, and setup instructions.

## [0.1.30] - 2026-07-15

- Added a VS Code-hosted adaptive Browser Agent Runtime with plan/progress state, one-action observation loops, loop detection, context compaction, deterministic evidence judgement, optional model judgement, and recoverable-only model fallback.
- Added the `browser_agent` tool with run, resume, get, and cancel operations, bounded local run history, model/token/fallback metrics, cancellation, and extension-host restart recovery.
- Routed legacy `planAndRun` tool calls through the adaptive Agent Runtime while preserving table, readiness, contract, and highlight hints; explicit workflows and browser jobs remain deterministic executors.
- Added sensitive-action review enforcement, autonomous action restrictions, and browser-side stale batch invalidation after navigation, tab, URL, focus, or DOM changes.
- Added a limited `custom.*` Agent Action plugin API with capability/risk metadata, destructive-action exclusion, namespace validation, and custom-action recursion prevention.
- Added Agent Runtime, resume, custom action registry, protocol stale-state, and schema drift tests plus operator and AI-agent documentation.

## [0.1.29] - 2026-07-14

- Fixed empty Copilot tool responses by returning user-readable tool output as `LanguageModelTextPart` while retaining structured JSON data parts.
- Added an extension-host regression test that invokes the capture and browser-state tools and verifies non-empty text results.
- Reworked the browser popup into a wider two-column layout that stays within the Chromium popup viewport with connection settings collapsed or expanded.

## [0.1.28] - 2026-07-14

- Redesigned the browser popup around clear bridge status, compact capture toggles, current-site permission state, accessible feedback, and collapsible connection settings.
- Added live connection-status updates, pairing-token visibility control, and screenshot-dependent redaction controls.
- Removed the manual investigation-name default and its capture fallback so the passive agent uses only investigation groups supplied by Copilot commands.

## [0.1.27] - 2026-07-14

- Upgraded the local bridge to protocol 3.0 with command leases, explicit ACK/completion ownership, lease-expiry redelivery, and idempotent result acceptance.
- Added persistent browser agent identities, multi-agent targeting through `targetAgentId` and `owenBrowserBridge.preferredAgentId`, plus active-agent health data.
- Added a persisted browser result outbox with timeout, exponential backoff, and discard handling for expired or invalid results.
- Replaced permanent web-wide host access with optional per-origin permissions and added **Grant current site access** plus agent/connection status to the browser popup.
- Persisted bounded checkpoints, run history, and recent command failures across MV3 service-worker restarts.
- Added the Browser Captures Explorer, storage status and confirmed deletion commands, atomic capture index/catalog updates, and SHA-256 integrity manifests.
- Expanded the action registry with required-input, effect-policy, confirmation, and protocol metadata and added independent schema drift checks.
- Added protocol-runtime and loopback HTTP integration tests covering authentication, protocol mismatch, routing, ACK ownership, result ownership, and duplicate result delivery.
- Hardened release packaging with browser JavaScript syntax checks, VSIX test/temp exclusions, `SHA256SUMS.txt`, and required protocol-runtime verification.
- Changed the release workflow to upload the current assets first, then retain exactly the newest GitHub Release and remote tag.

## [0.1.26] - 2026-07-14

- Added expiring browser commands, queue size limits, timeout removal, late-result metrics, and protocol/version health metadata.
- Moved the browser pairing token from synced storage to local storage with automatic migration.
- Added screenshot redaction profiles that blur sensitive fields and strict-mode identity/network values before PNG capture.
- Added `effectPolicy` to observe or require URL, DOM, scroll, focus, or target-state changes after interactive actions.
- Changed browser jobs into persisted, cancellable, stepwise jobs that resume through the polling loop.
- Added a global capture catalog, `search_browser_captures`, and opt-in age/count retention settings.
- Added a typed action registry plus compact read, interact, workflow, evidence, and admin LM tools while retaining `browser_act` compatibility.
- Added persisted, versioned scenario template list/save/delete/export actions.
- Expanded `runtimeSnapshot` with navigation timing, paint, LCP, CLS, and long-task metrics.
- Replaced the sample test with command queue, action schema, redaction, and allowed-host policy coverage.

## [0.1.25] - 2026-07-14

- Changed the browser extension into a passive paired agent controlled from VS Code.
- Added long-poll command delivery for near-immediate `browser_act` execution without opening the browser popup.
- Kept the 30-second browser alarm as a service-worker recovery fallback.
- Removed the manual **Send Current Tab** control from the browser popup.

## [0.1.24] - 2026-06-06

- Added `runScenarioTemplate` for reusable browser automation scenario templates.
- Added 10 built-in generic scenario templates for readiness, evidence, guarded actions, tab/auth flows, forms, downloads, recovery, drilldown, handoff, and jobs.
- Added Microsoft Security templates for Defender XDR, Sentinel, Entra, MDE, MDO, Defender for Identity, Defender for Cloud, Purview, and cross-portal handoff workflows.
- Added `scenarioName`, `scenarioTemplates`, and richer `params` support for template execution.

## [0.1.23] - 2026-06-06

- Added `tabOrchestrator` to classify, return to, and optionally clean up browser tabs by logical role.
- Added `popupGuard` to warn or block on unexpected, auth, permission, and security-warning tabs.
- Added `returnToTab` to reactivate a tab by logical role or tab index.
- Added `tabRunSummary` to summarize current-window tabs, roles, signals, and recommended next action.

## [0.1.22] - 2026-06-06

- Added `failureExplainer` to classify recent browser automation failures and suggest recovery actions.
- Added `waitProfiler` to compare page readiness wait strategies.
- Added `automationHealthScore` to score auth, loading, DOM stability, target, and selector-memory readiness.
- Added `sensitiveActionGuard` to pass, warn, or block potentially destructive actions.

## [0.1.21] - 2026-06-06

- Added `safeActionPreview` to preview target and confirmation risk before acting.
- Added `stableTargetProfile` for durable selector and accessibility target scoring.
- Added `guidedDrilldown` for table/list row-to-detail workflows.
- Added `evidenceCompletenessCheck` with capture-group completeness artifacts.

## [0.1.20] - 2026-06-06

- Added `planAndRun` for guarded goal-driven browser workflows.
- Added `evidenceClaimCheck` to compare report claims with visible page and table evidence.
- Added `tableWatchAndDiff` for row-level table change detection.
- Added `browserRunBundle` to assemble capture-group run bundle artifacts.

## [0.1.19] - 2026-06-06

- Added `buildEvidencePack` to assemble capture-group evidence pack Markdown/JSON artifacts.
- Added `buildNavigationGraph` to summarize recent browser action flow as graph artifacts.
- Added readiness and contract checks with `waitPreset` and `assertPageContract`.
- Added operational reports for handoff, selector health, capture review queue, and lightweight browser jobs.

## [0.1.18] - 2026-06-06

- Added `accessibilitySnapshot` for role/name-oriented page structure inspection.
- Added `mapForm` to return form field schemas before filling complex forms.
- Added `watchPageChanges` to observe DOM, URL, text, and resource changes over a short window.
- Added `highlightEvidence` to generate screenshot evidence with labeled highlight boxes.

## [0.1.17] - 2026-06-06

- Fixed capture redaction so top-level browser session summaries in stored Markdown and JSON are redacted consistently with page summaries.

## [0.1.16] - 2026-06-06

- Added `visualAssert` for post-action text, selector, and page fingerprint assertions.
- Added selector memory so successful and auto-healed targets can be reused on later actions for the same host and intent.
- Added `Owen Browser Bridge: Show Action Trace` to inspect recent browser action logs from VS Code.
- Added configurable capture redaction profiles and custom redaction regex patterns for stored JSON and Markdown evidence.

## [0.1.15] - 2026-06-06

- Added deep target lookup across Shadow DOM and same-origin iframes with `targetScope` and `frameDepth`.
- Added network wait conditions with `wait.kind=networkIdle` and `wait.kind=requestDone`.
- Added interactable scoring for target inspection and interactable listing.
- Added `retryProfile` and lightweight `captureBeforeAfter` diff metadata for resilient workflows.
- Improved `smartFormFill` handling for date, telephone, checkbox, radio, select, and contenteditable fields.
- Added `recordWorkflow` and `replayWorkflow` macro actions with parameter substitution.
- Added `release:local` and `install:local-vsix` so releases install the built VSIX into local VS Code.

## [0.1.14] - 2026-06-06

- Added `captureElement` to capture screenshot evidence clipped to a target element with optional padding.
- Added `captureRegion` to capture screenshot evidence clipped to explicit region coordinates.
- Added `regionX`, `regionY`, `regionWidth`, `regionHeight`, and `regionPadding` inputs to `#browserAct`.
- Added partial capture metadata (`partialCapture`) to stored evidence metadata for traceability.

## [0.1.13] - 2026-06-06

- Renamed the browser extension UI label from "Owen Capture" to "Owen Browser Bridge Agent".

## [0.1.12] - 2026-06-06

- Fixed `readPage` and capture snapshots after adding capture quality scoring by keeping injected quality scoring logic inside the page context.

## [0.1.11] - 2026-06-06

- Fixed paired browser tab detection when Chrome or Edge reports a valid tab id of `0`.

## [0.1.10] - 2026-06-06

- Added `inspectTargets` for ranked visual and accessibility target inspection before browser actions.
- Added `targetHint` and `autoHeal` support so failed DOM target actions can retry likely visual/accessibility candidates.
- Added capture quality scoring in `screenSummary.captureQuality` for auth, loading, and low-evidence capture states.

## [0.1.9] - 2026-06-05

- Added OS-specific capture directory settings for Windows and macOS, including setup page fields for separate directory paths.

## [0.1.8] - 2026-06-05

- Added 10 browser control actions for advanced investigations: `networkTraceCapture`, `safeDownloadAndHash`, `tableExtract`, `stateCheckpoint`, `rollbackToCheckpoint`, `humanReviewGate`, `bulkActionFromList`, `semanticWait`, `compareCaptureRuns`, and `policyGuard`.
- Extended `#browserAct` schema and runtime validation for checkpointing, semantic waits, policy profiles, manual review gates, and run-to-run comparison inputs.

## [0.1.7] - 2026-06-05

- Added `journeyCapture` and `paginateCapture` browser actions for URL traversal and multi-page evidence collection under Copilot control.
- Added structured extraction support via `extractSelectors` for per-page key-field capture during traversal.
- Added authentication pause and resume flow with `resumeAfterAuth` for browser sign-in gated pages.

## [0.1.6] - 2026-06-05

- Expanded `#browserAct` into advanced browser automation with workflow execution (`runWorkflow`), resilient targeting (`retries`, `fallbackSelectors`, `fallbackTexts`), and optional presets.
- Added richer action coverage: wait conditions, interactable listing, scroll/hover/key press/select/clear input, browser history controls, and tab lifecycle actions.
- Added safety confirmation gating for destructive browser actions such as tab close.
- Updated tool schema and usage documentation for advanced browser control.

## [0.1.5] - 2026-06-05

- Fixed browser-injected action and capture functions so page text, metadata, click-by-text, type, and wait-for-text work inside Chrome/Edge tab contexts.
- Improved reliability of `#browserAct` evidence captures for Defender incident pages.

## [0.1.4] - 2026-06-05

- Added paired browser command polling from the Chrome/Edge extension to VS Code.
- Added `#browserAct` for Copilot-driven read, capture, navigate, click, type, and wait-for-text actions on allowed hosts.
- Added automatic post-action captures so browser actions leave evidence in the current investigation group.
- Added a browser popup toggle for accepting Copilot browser actions.
- Added safety checks for allowed hosts and password fields during browser control.

## [0.1.3] - 2026-06-05

- Added host and investigation-group capture folders for related multi-page investigations.
- Added `_index.json` and `_summary.md` files inside each capture group folder.
- Added `#readBrowserCaptureGroup` for reading and correlating all captures in a host or investigation group.
- Added an optional browser popup field for investigation or case names.
- Updated documentation for grouped capture analysis workflows.

## [0.1.2] - 2026-06-05

- Added `Owen Browser Bridge: Open Setup Page` with buttons to start or stop the local server.
- Added setup page buttons to copy or regenerate the pairing token without displaying it on screen.
- Added setup page controls to add, edit, or remove allowed browser hosts.
- Added setup page controls to update or reset the capture directory.
- Updated pairing setup documentation to use the setup page workflow.

## [0.1.1] - 2026-06-05

- Added release scripts that package and verify both the VSIX and browser extension ZIP.
- Added release guidance for downloading the browser extension as a ZIP asset alongside the VSIX.
- Updated Windows/macOS install commands for the v0.1.1 package.

## [0.1.0] - 2026-06-05

- Added VS Code localhost capture server with pairing token authentication.
- Added Chrome/Edge browser extension for current-tab text, metadata, and screenshot capture.
- Added Language Model Tools for Copilot access to latest and specific browser captures.
- Added setup and usage documentation.
- Expanded extension detail documentation with step-by-step pairing token setup and troubleshooting.
- Added GitHub repository based install instructions for Windows and macOS.
