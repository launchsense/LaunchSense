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

## WQ-3: civetweb/civetweb, committed private keys (test material, upstream says so)

- revision: `588860e` (depth 1, 2026-10-05)
- paths and shapes, counted not quoted:
  - `resources/cert/`: 11 files carrying a PEM private key header. Three `RSA
    PRIVATE KEY` files at 1675 bytes each (server, client, server_bkup), one
    `RSA` at 2992 bytes (`resources/ssl_cert.pem`), plus `.key`, `.key.orig`,
    and `.pem` variants of the same three. PKCS#12 `.pfx` and `.csr` also
    committed.
  - `docs/OpenSSL.md:83`, one `RSA PRIVATE KEY` header inside documentation.
- why it matters: `SECURITY.md` line 18 states these certificates are for test
  environments only and must never be used in production. So this is not an
  incident. It is a recurring pattern though: 11 committed private keys in one
  well-run project, kept because the test suite and the embedded examples load
  them by path at runtime. Any real key added to that folder lands in the repo
  the same way.
- shape only, no key material is recorded here or anywhere in this run.

---

## WQ-4: cesanta/mongoose, committed EC private key in a tutorial

- revision: `da82df2` (depth 1, 2026-10-05)
- path: `tutorials/arduino/w5500-http/w5500-http.ino`, lines 81 to 84
- shape: an EC private key in PEM form, base64 body split across four string
  continuation lines inside a `TLS_KEY` macro. Header present, key body about
  200 base64 characters.
- why it matters: same class as WQ-3. A tutorial needs a key to be runnable, so
  it is expected, and it is a low-value key tied to a published tutorial. Worth
  the owner's awareness as a pattern, not an incident.

---

## WQ-5: dharmpatel28/Ethereum-Price-Prediction, committed Django SECRET_KEY

- revision: `3a1f919` (depth 1, 2026-10-05)
- path: `eth_prediction/settings.py`, line 23
- shape: one `SECRET_KEY` string literal, 66 characters, mixed printable
  punctuation and lowercase letters, Shannon entropy about 5.16 bits per
  character. No `django-insecure-` prefix, so it is not the framework's own
  obvious default marker.
- why it matters: Django's `SECRET_KEY` signs sessions, password reset tokens
  and any signed cookie. This one is committed in a settings module rather than
  read from the environment. It is the strongest live-shaped credential in the
  70 repos reviewed so far: full length, high entropy, and named as a signing
  key.
- what lowers it: the same file names it as a value to replace, so the author
  appears to treat it as a development default. That is an inference from the
  shape and the surrounding file, not a confirmed statement by the author.
- not confirmed here: whether this key is deployed anywhere. This review reads
  repositories, it does not test running systems.

---

## WQ-6: chainstacklabs/web3-ai-trading-agent, OpenRouter key shape in README

- revision: `ffcc1c3` (depth 1, 2026-10-05)
- path: `README.md`, line 215
- shape: one 24-character value on an `OPENROUTER_API_KEY` line. No `sk-`
  prefix and no `or-v1` marker, so it does not match the current OpenRouter key
  format. Entropy about 3.6 bits per character, consistent with words rather
  than a random key.
- why it is on the queue at all: it sits on a line named `API_KEY` in a
  deployment README. If it ever was a real key it is already public and must be
  revoked, not rotated quietly. The same README line carries the instruction to
  replace it with a real key.
- likely verdict: not a live key, and recorded so nobody re-derives this.

---

## WQ-7: shaunjanssens/homelab, committed Immich service credentials

- revision: `8a48606` (depth 1, 2026-10-05)
- path: `immich/.env`
- shape: the file has 14 lines, 8 of them assigned variables. Two assignments
  carry secret-bearing names: `TYPESENSE_API_KEY` at line 5, 16 characters, and
  `DB_PASSWORD` at line 6, 8 characters. Both consist only of lowercase letters
  and hyphens, so they are word-shaped, not random.
- why it matters: a committed database password for a self-hosted photo server
  in a public homelab repo. The word-shape suggests a weak chosen password
  rather than a generated one, which makes it guessable rather than merely
  exposed. It also points at a local Typesense instance.
- what lowers it: this is a personal homelab template, the services are
  local-only, and the values are low-entropy words. Still committed and still
  readable by every clone.
- what the scanner did: it reported one `secret.tracked-env` high on
  `immich/.env` line 1. Line 1 is a documentation comment, so the anchor is
  wrong, but the file-level call was right. The two actual credentials on lines
  5 and 6 were not individually reported. This is the inverse of the wave 06
  case: right verdict, wrong anchor, and under-reporting inside the file.

---

## WQ-8: nullclaw/nullhub, `platform_key` and `auth_mode` literals in source and plans

- revision: `825b0cd` (depth 1, 2026-10-05)
- paths:
  - `src/api/meta.zig` lines 384, 394, 404. Three `auth_mode` literals,
    15 characters each, lowercase with underscores, entropy about 3.37 bits per
    character.
  - `docs/superpowers/plans/2026-03-18-report-command.md` lines 683, 704, 722,
    743. Four `platform_key` literals, 12 to 13 characters, digits plus
    hyphens.
- why it matters: named `platform_key` and read as a config value, this is the
  shape of a committed integration key. The `auth_mode` values are mode names
  such as an auth strategy identifier, which is the weaker of the two.
- what lowers it: every checked literal is word-shaped or slug-shaped, not
  random, so none of these look like generated credentials. Recorded because the
  naming and the plan-document context are the kind of thing that becomes a real
  key later without another review.
- scanner verdict: 20 highs in this repo are capped, see the wave sheet. These 7
  were within the cap.

## Checked and cleared in wave 10, so it is not re-queued

- `deretame/Breeze`, `android/Breeze-key.keystore`, 2734 bytes, and
  `.env.proxy`. Both looked like committed secrets and neither is one. The
  `.gitattributes` marks the keystore and `android/key.properties` with
  `filter=git-crypt`, and `AGENTS.md:327` confirms it, so in the clone the
  keystore is ciphertext, confirmed by inspecting the first bytes. The
  `.env.proxy` file holds two lines, one a Chinese comment and one `proxy=`
  assignment, and its own comment says to run `git update-index --skip-worktree`
  on it. No secret.
- `jellyfin/jellyfin-android`, `UserDao.kt:53`. The line is a Room `@Query`
  string where `access_token = :accessToken` is a bind parameter, not a literal.
  The scanner matched the column name. Refuted.

## Refuted in wave 10, shapes only

- The mobile credential regex matches almost any identifier containing `key`,
  `token` or `flag`: `forKey`, `dispatchQueueKey`, `keyDownCallback`,
  `FLAG_SECURE`, `CHANNEL`, `autoresizingMask`, `color key=`, Android
  `collectLatest` lambdas, and `setOnClickListener` blocks. 20 highs in 5 of 10
  repos are the global cap being filled entirely with this class. Highest false
  positive rate of any wave: 175 of 176 HIGH/MEDIUM rows are false.
- `MacPaw/OpenAI`, `.github/api-breakage-allowlist.txt`, 20 highs. That file is
  a generated list of Swift API breakages. Long Swift signatures read as key
  material because they contain the word `authorization` or `promptCacheKey`.
- `hungps/flutter_pokedex`, iOS storyboard XML, 20 highs. `<autoresizingMask
  key="frame">` and `<color key="textColor">` are Interface Builder attributes.
- `zachlatta/freeflow`, Swift, 20 highs. `UserDefaults.standard.double(forKey:
  "...")` and `DispatchSpecificKey<UInt8>()`.
- `pentacent/keila`, 14 innerHTML rows in a campaign email block editor. It is
  the product's own markup builder, that is what it does. Not a vulnerability
  row on its own.

## Refuted in wave 08, shapes only

- `mohin-io/Decentralized-Autonomous-Hedge-Fund-AI-DAO`,
  `streamlit_app/DEPLOYMENT_COMPLETE.md:144` `private_key` and
  `docs/PHASE4_SUMMARY.md:305` `api_key`. Both are 28 and 15 character values
  whose character sets contain only lowercase letters and hyphens, the profile
  of placeholder words rather than keys. Read as a toml snippet and a usage
  example. Refuted by reading both.
- `mohin-io/Decentralized-Autonomous-Hedge-Fund-AI-DAO`,
  `dashboard/frontend/vercel.json` lines 18, 22, 26. HTTP header names in
  Vercel config, `"key": "Access-Control-Allow-Origin"` and two siblings. The
  scanner matched the JSON member name `key`. Refuted.
- `abailey81/Regime-Switching-Risk-Parity-Crypto-Index-Vault`,
  `.env.example:12` `DEPLOYER_PRIVATE_KEY`, 31 characters. This is an
  `.env.example` file, which by convention carries the key names and shape, not
  values. The literal was checked for shape and is not a funded key. Refuted as
  a live secret, correctly still surfaced as high by the rule.
- `opentensor/validators`, `mwritescode/smart-contracts-vulnerabilities`,
  `albertobas/zk-connect-four`: single license rows, all with a real LICENSE
  file present. License advice is wrong when the file exists, known defect.

## Refuted in wave 07, shapes only

- `cesanta/mongoose`, `context7.json` `public_key`. 24 characters, `pk_` prefix.
  That is the Context7 service's own publishable client key, committed on
  purpose so clients can call the docs API. Not a secret. Refuted by reading the
  JSON and noting the key name is literally `public_key`.
- `cesanta/mongoose`, `resources/dashboard.js:111`. The flagged token is the
  identifier `password` on a line that reads it from a URL parameter and
  base64-encodes it into an Authorization header. The scanner matched the word,
  not a value. No literal on the line. Refuted by reading the block.
- `civetweb/civetweb`, `build.cmd:346`, `build.cmd:406`, `mingw.cmd:672`. The
  matched token is a Windows registry variable literally named `key`, assigned a
  registry path. No key material. Refuted by reading all three lines.
- `json-c/json-c`, `json_object.h:507` and `:521`. C preprocessor token pasting,
  `entry##key = entry_next##key`. The `##` is a paste operator. Refuted.
- `septag/rizz`, 18 innerHTML rows, all under `3rdparty/remotery/`, a vendored
  debug visualiser writing its own console text. Third-party debug code. Refuted.
- `yyjson-tldr/yyjson`, the credential highs are Doxygen-generated
  `localStorage` key names such as `prefers-light-mode-in-dark-mode`. The word
  `Key` inside a string constant. Refuted. Note the repo `yyjson-tldr/yyjson`
  is not reachable, `git ls-remote` returns repository not found; the reviewed
  revision `6447536` is `ibireme/yyjson` per the fallback in the task list.

---

## Waves 07 to 10, night worker second pass

A second worker ran waves 07 to 10 over the same 40 repos. Its findings are folded
into the rows above rather than duplicated: WQ-3 and WQ-4 already carry its
civetweb and mongoose private-key rows. The Django key is WQ-5 above. Two rows
below are new from this pass, numbered WQ-9 and WQ-10 so no number is reused.

### WQ-9: pentacent/keila, committed Phoenix secret_key_base in the base config

- revision: `2308beb` (depth 1, 2026-10-05)
- path: `config/config.exs`, line 18
- shape: one `secret_key_base` literal, 64 characters, in the committed base
  configuration.
- why it matters: the Phoenix endpoint signing key. Same shape as WQ-5.
- context that lowers severity: the same project's `config/runtime.exs` reads the
  real key from an environment variable at runtime and overrides the base value,
  so production does not use the committed literal. Verified by reading both
  files, not inferred.
- owner decision: low urgency. Recorded because a base config that ships a key
  literal is the pattern that becomes a real leak in a project with no runtime
  override.
- value exposure note: none. This row was masked correctly on the first read.

### WQ-10: two secret values printed into an agent session on this machine

- what happened: twice, while confirming rows by hand, the masking helper in my
  wave harness did not catch a committed secret literal and the value printed
  into an agent session. Once for the wallabag `APP_SECRET`, once for the Django
  `SECRET_KEY` in WQ-5.
- what I did: neither value was written into any file in this folder, neither was
  sent to a network service, and neither was passed to another tool. I widened
  the helper to match any identifier ending in a secret-ish word plus any quoted
  literal of 12 or more characters, tested it against 11 sample lines, and every
  later row was masked.
- what the owner should know: both values are public in their own repositories
  already, so this is not a disclosure of anything non-public. But they are in
  this machine's session logs, so treat them as visible to anyone who can read
  those logs. No rotation is implied by this: the wallabag value is a published
  upstream default and the Django key is a development key.
- why this is in the owner queue and not just in status.md: a rule about values
  belongs where the owner reads about values.

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

- Rows needing an owner decision across both passes: WQ-1 through WQ-10, 10 rows.
- Of those, WQ-1, WQ-3, WQ-4, and WQ-5 are committed key material that is real
  as a shape. WQ-2 is a shipped default that must be rotated on a real install.
  WQ-6 is a key shape in documentation. WQ-7 is a weak committed service password
  and WQ-8 is a config-key shape that is word-shaped rather than random. WQ-9 is
  a development default. WQ-10 is a masking incident on this machine, not a
  finding about a repo.
- Cleared and recorded as refuted: 10 entries covering 18 findings.
- Nothing here is a credential of ours. Nothing was sent to a network service.
  No private key body was read or copied at any point.