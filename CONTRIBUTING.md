# Contributing

Thank you for contributing to Owen Browser Bridge.

## Development

1. Install a current Node.js release compatible with the dependencies.
2. Run `npm ci` from the repository root.
3. Make a focused change with tests where behavior changes.
4. Run `npm run release:check` before submitting a pull request.

Use `npm run compile`, `npm run lint`, and a focused test during development. Keep generated captures, screenshots, credentials, cookies, pairing tokens, and customer or investigation data out of commits and issues.

## Pull Requests

- Describe the behavior change and its user impact.
- Include validation steps and relevant test results.
- Update `README.md` and `docs/ai-agent-browser-control-guide.md` for new user-facing browser capabilities.
- Preserve operator review and safety guards for destructive or sensitive browser actions.
- Report security vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

Unless you explicitly state otherwise, contributions intentionally submitted for inclusion in this project are provided under the Apache License, Version 2.0, as described in [LICENSE.txt](LICENSE.txt).
