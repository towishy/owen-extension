# Privacy

Owen Browser Bridge connects a browser extension, a localhost VS Code extension, and optional VS Code language-model tools. This document describes the project's data flow; third-party services remain governed by their own terms and privacy policies.

## Data Processed

Depending on the action and settings, the extension can process the active tab URL, title, visible text, page structure, form metadata, HTML snapshots, screenshots, interaction results, downloads selected for hashing, and browser automation traces. This data can contain personal, business, authentication, or security investigation information.

The pairing token is stored in browser-local extension storage and VS Code SecretStorage. It is not stored in browser sync storage.

## Storage And Transmission

- The browser extension sends captures and command results to the configured bridge on `127.0.0.1`.
- Captures are written to the configured local capture directory. The default is `raw/browser-captures/` in the current workspace.
- Agent runs and recent state are stored in VS Code extension storage.
- The project does not include a maintainer-operated telemetry, advertising, or remote capture service.
- When a user invokes Copilot analysis or an Agent Run, selected page state, goals, traces, or evidence can be sent through the VS Code Language Model API to the selected model provider. That processing is governed by the provider and VS Code account terms.
- Some explicit browser actions can request resources from the active allowed page, including authenticated downloads selected for local hashing. Those requests are made to the visited service under its own policies.

## Browser Permissions

The browser extension requests `activeTab`, `alarms`, `scripting`, `storage`, `tabs`, and `<all_urls>`. Permanent page access supports passive pairing and operator-requested capture or automation across configured sites. The VS Code Allowed Hosts policy separately limits which page hosts can submit captures and receive actions.

## User Controls

Users can restrict Allowed Hosts, disable browser actions, disable screenshots or HTML capture, select a redaction profile, configure retention, delete local captures, regenerate the pairing token, stop the localhost server, or uninstall either extension.

Automatic redaction reduces common sensitive values but cannot guarantee removal of every sensitive field. Review captures before sharing or committing them.

Report privacy or security vulnerabilities using [SECURITY.md](SECURITY.md).
