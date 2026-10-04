# Secrets and setup safety

LaunchSense reads the repo you point it at. It should never need your real secret values. It only records rule IDs, paths, line numbers, fingerprints, and redacted snippets.

When you connect a project, the setup guard should check:

- tracked `.env` files,
- committed private keys,
- OAuth client secrets,
- GitHub tokens,
- API keys in source files,
- log files or transcripts with named secrets.

If the guard finds one, stop and fix it. Do not push it, paste it, or upload it as a demo artifact.

## If a secret appears by mistake

1. Treat it as exposed.
2. Rotate it.
3. Delete local logs that only help you debug.
4. Push a fix only after the secret is gone.

Never run a command that prints an env secret in chat or a public transcript just to verify it is present.
