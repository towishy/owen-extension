# Owen Browser Bridge Copilot Instructions

When the user asks to analyze browser, Defender, Entra, Azure portal, alert, screenshot, or captured web data:

- Prefer `#getLatestBrowserCapture` for the newest capture.
- Use `#readBrowserCapture` when the user provides a capture id or path.
- If tools are unavailable, inspect `raw/browser-captures/<host>/<group>/*.md`, adjacent `*.json`, adjacent `*.png`, `_index.json`, and `_summary.md`.
- Treat captures as sensitive. Do not suggest committing raw captures or screenshots.
- Preserve evidence boundaries: distinguish visible page text, metadata, screenshot observations, and inference.
- For Defender alert analysis, organize results as evidence, likely interpretation, risk, missing context, and next actions.