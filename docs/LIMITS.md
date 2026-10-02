# Limits

- Guest scans only. There are no accounts yet, so each scan stands alone.
- GitHub quota is shared. When it runs out, scans show partial with a retry time.
- Caps per scan: 200 files, 2 MB in total, 100 KB per file. Skipped files are listed as not checked.
- Binary files and generated folders like node_modules, dist, and build are skipped.
- Dependency freshness and deps.dev data are not checked yet.
- Vulnerability lookup covers npm, PyPI, and Go. Timeouts show as unknown, never as safe.
- License notes are signals, not legal advice.
- A partial result is never a pass.
