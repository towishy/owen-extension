# Change Log

All notable changes to the "owen-browser-bridge" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

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