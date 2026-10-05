# Security policy

## Reporting a vulnerability

Do not open a public issue for a security problem.

Contact the maintainer at www.withkeshav.com with:

- What the problem is, and where (file, route, or feature).
- The steps to reproduce it.
- Whether it exposes repository data, a secret, or a way to spend provider budget.

You will get an acknowledgement, and a note when it is fixed.

## What this project does with your data

- It scans a public repository and stores findings, not file bodies.
- It never returns a raw secret value. Redaction removes every shape the detector accepts.
- A partial result is never a pass.
- The local MCP server reads files on your machine and does not upload them.

## Supported versions

The `main` branch and the latest release.
