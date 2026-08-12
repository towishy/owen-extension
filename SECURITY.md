# Security Policy

## Supported Versions

Security fixes are applied to the latest released version of Owen Browser Bridge. Upgrade to the newest release before reporting a problem that may already be fixed.

## Report A Vulnerability

Do not disclose vulnerabilities in a public issue. Use GitHub's private vulnerability reporting page:

<https://github.com/towishy/owen-extension/security/advisories/new>

Include the affected version, impact, prerequisites, and minimal reproduction steps. Use synthetic data. Never include pairing tokens, cookies, credentials, raw captures, screenshots, customer data, or security investigation data.

If private vulnerability reporting is unavailable, open a public issue that requests a private contact channel without including vulnerability details.

## Operational Security

- The bridge listens only on `127.0.0.1`.
- All capture and command endpoints require the pairing token.
- The unauthenticated health endpoint returns only service and protocol compatibility fields.
- Regenerate the pairing token after suspected exposure.
- Keep `raw/browser-captures/` and screenshots out of source control.
- Treat captures as potentially sensitive even after automatic redaction.
