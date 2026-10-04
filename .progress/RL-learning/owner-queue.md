# Owner queue: live-looking severity found by the scanner

Shapes only. No secret values are recorded here, ever. Each entry names the
repo, the revision, the shape of what was found, and why it matters. The owner
decides what happens next. Nothing in this file has been sent anywhere.

Format: one block per finding. `shape` describes form and length, never content.

---

## WQ-1: sidekiq/sidekiq, committed Rails secret_key_base

- revision: `7c0646e` (depth 1, 2026-10-05)
- path: `myapp/config/secrets.yml`, lines 14 and 17
- shape: two literals, hex alphabet only, 128 characters each, no whitespace.
  Keys are the development and test blocks. Line 22 is an `ENV[...]` reference,
  so the file mixes committed literals with an env read.
- why it matters: `secret_key_base` signs Rails cookies and session data. These
  are full-length random values, not placeholders, and the file's own comment
  asks that secrets in it be kept private.
- reach: the file is inside the repository, so every clone has it. The bundled
  app is a demo app, which lowers real-world impact but does not change that the
  values are committed and readable.
- scanner verdict: the `secret.credential-pattern` high at
  `myapp/config/initializers/secret_token.rb:7` is the same class of literal and
  was also reported.
- not confirmed here: whether either value is ever deployed anywhere. This review
  does not test live systems.

---

## WQ-2: wallabag/wallabag, committed APP_SECRET in a tracked .env

- revision: `a5be36b` (depth 1, 2026-10-05)
- path: `.env`, line 1
- shape: one `APP_SECRET=` literal, lowercase alphanumeric, 16 characters.
- why it matters: `APP_SECRET` is the Symfony application secret. It is in a
  tracked `.env`, which is the exact file shape the `secret.tracked-env` rule
  exists to catch, so the rule was right to fire on this one.
- context that lowers severity: the value is upstream's published default. It is
  not a distinct credential and it is not the only value a deployer has to
  change. Treat as shipped default that must be rotated on any real install.
- scanner verdict: the other six highs in this repo are false positives, see
  wave-full-06.md.

---

## Refuted, recorded so they are not re-reported

- `18F/identity-reporting-rails`, `.secrets.baseline` lines 138, 145, 152. Three
  `hashed_secret` entries, 40 characters. These are detect-secrets baseline
  hashes, that is the tool's whole purpose in that file. Not a live secret.
  Refuted by reading the file.
- `thoughtbot/paperclip`, `spec/paperclip/storage/s3_spec.rb:478`. The literal
  is a short digit string used as a test fixture `access_key_id`. Test fixture,
  not a credential. Refuted by reading the file.
- `gothinkster/laravel-realworld-example-app`, `.env.travis:1`. The flagged line
  is `APP_ENV=testing`. The scanner flagged the presence of a tracked env file
  and anchored on line 1, which is a boolean about the file, not about a
  secret. No secret on that line.

---

## Waves 07 to 10, added by the night worker

### WQ-3: dharmpatel28/Ethereum-Price-Prediction, committed Django SECRET_KEY

- revision: `3a1f919` (depth 1, 2026-10-05)
- path: `eth_prediction/settings.py`, line 23
- shape: one `SECRET_KEY` literal, 66 characters, carrying the standard
  `django-insecure-` prefix. Committed.
- why it matters: the Django signing key signs sessions and password-reset
  tokens. A committed key is readable by anyone who clones the repo.
- context that lowers severity: the same file sets `DEBUG = True` and
  `ALLOWED_HOSTS = []`. That is a development configuration, so the key is
  probably a local one. Whether anyone deployed this unchanged is not proven and
  was not tested.
- not confirmed here: whether the value is live anywhere.
- owner decision: if this project is deployed, rotate. If it is a tutorial, no
  action. A sample project that ships a real key is still a bad pattern to copy.
- value exposure note: the older masking helper in the wave harness did not
  cover a name that contains `SECRET` with a suffix, so this literal printed into
  an agent session on this machine. It was not written into any file in this
  folder and was not sent anywhere. The helper was widened before the later rows
  ran and every later row was masked. Recorded so the owner knows it sits in this
  machine's session logs.

### WQ-4: pentacent/keila, committed Phoenix secret_key_base in the base config

- revision: `2308beb` (depth 1, 2026-10-05)
- path: `config/config.exs`, line 18
- shape: one `secret_key_base` literal, 64 characters, in the committed base
  configuration.
- why it matters: the Phoenix endpoint signing key. Same shape as WQ-3.
- context that lowers severity: the same project's `config/runtime.exs` reads
  the real key from an environment variable at runtime and overrides the base
  value, so production does not use the committed literal.
- owner decision: low urgency. Recorded because a base config that ships a key
  literal is the pattern that becomes a real leak in a project with no runtime
  override.

### WQ-5: civetweb and mongoose, 13 committed private-key headers

- revisions: `civetweb/civetweb` `588860e`, `cesanta/mongoose` `da82df2`
- paths: civetweb `resources/cert/*` (9 files, RSA and EC),
  `resources/ssl_cert.pem`, plus one EC key under the mongoose Arduino tutorials
- shape: `-----BEGIN RSA PRIVATE KEY-----` and `-----BEGIN EC PRIVATE KEY-----`
  block headers, one finding per file, 13 findings total.
- rule: `secret.private-key` (high)
- why it matters: real private key material sitting in a public repository.
- context that lowers severity: these are the demo certificates the projects ship
  on purpose so their TLS examples run. They are not a production key.
- not confirmed here: no key body was read, opened, or copied anywhere, by
  design. Only the block header on line 1 of each file was read.
- owner decision: none. This is the expected fixture pattern for a library with
  TLS examples. Listed so the true-positive count is honest: 13 of the 13
  `secret.private-key` rows in 100 repos are real private-key headers.

### Cleared in waves 07 to 10, recorded so they are not re-reported

- `abailey81/Regime-Switching-Risk-Parity-Crypto-Index-Vault`, `.env.example`
  lines 12 and 15. Two keys, `DEPLOYER_PRIVATE_KEY` and `ETHERSCAN_API_KEY`,
  with values of 31 and 22 characters made of underscore-separated lowercase
  words. Placeholder-shaped, in the one file whose purpose is placeholders.
- `chainstacklabs/web3-ai-trading-agent`, `README.md:215`. A 24-character key
  literal on a line whose own trailing comment says to replace it.
- `shaunjanssens/homelab`, `immich/.env`. Flagged tracked-env. Read every
  assignment by key name and value shape: `TYPESENSE_API_KEY` 16 chars and
  `DB_PASSWORD` 8 chars, both low entropy and guessable from the compose file
  beside them. No credential. The rule fired on the file, not the value.
- `jellyfin/jellyfin-android`, `UserDao.kt:53`. An `@Query` annotation whose SQL
  string mentions `access_token`. A SQL template, not a token.
- `cesanta/mongoose`, `context7.json:3` and `resources/dashboard.js:111`. A
  publishable key identifier and a variable that reads a password from a config
  object. Neither is a literal credential.

## Counts for waves 07 to 10

- New rows needing an owner decision: 3 (WQ-3, WQ-4, WQ-5).
- Cleared and recorded: 5 entries covering 9 findings.
- Nothing here is a credential of ours. Nothing was sent to a network service.
  No private key body was read or copied.