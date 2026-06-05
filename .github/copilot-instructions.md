# Owen Browser Bridge Copilot Instructions

When the user asks to analyze browser, Defender, Entra, Azure portal, alert, screenshot, or captured web data:

- Prefer `#browserAct` when the user provides a URL to open/capture, asks to inspect the current browser screen, or asks Copilot to click/type/wait/scroll in the paired browser.
- Use `#getBrowserState` when the user asks what browser/page/tab is currently shared, what Copilot can see, or what the next browser action should target.
- Prefer `#getLatestBrowserCapture` for the newest capture.
- Use `#readBrowserCapture` when the user provides a capture id or path.
- Treat `screenSummary` as the primary structured page state: headings, landmarks, interactables, formFields, tables, viewport, and textSample.
- If tools are unavailable, inspect `raw/browser-captures/<host>/<group>/*.md`, adjacent `*.json`, adjacent `*.png`, `_index.json`, and `_summary.md`.
- Treat captures as sensitive. Do not suggest committing raw captures or screenshots.
- Preserve evidence boundaries: distinguish visible page text, metadata, screenshot observations, and inference.
- For Defender alert analysis, organize results as evidence, likely interpretation, risk, missing context, and next actions.