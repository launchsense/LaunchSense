// Does a value look like an actual credential?
//
// The line-level analyzer decides WHETHER the text assigns to a credential-looking
// name. This decides whether the VALUE could be a credential at all. Both must be
// true before a high severity finding is raised.
//
// The reason this exists, measured 2026-10-04: on a 6-repo corpus the analyzer
// produced 9 "hardcoded credential" findings and all 9 were false positives. A false
// positive in a security tool is worse than a miss, because it teaches the reader to
// ignore the tool. The old rule only required 3 characters, so `apiKey: 'base'` fired.
//
// The rule, in order:
//   1. Reject known placeholders and non-secret shapes.
//   2. Accept known provider key formats immediately. Format beats length and entropy.
//   3. Otherwise require real entropy from the value.
//
// Provider formats are checked FIRST and bypass entropy, so tightening the generic
// rule cannot turn a real key into a miss.
//
// One rule is scoped by the NAME the value sits under, the `name` argument below. Every
// other rule judges the value on its own. Measured on this repo on 2026-10-05: the
// value gate took any string of 20 characters with 10 distinct ones, so the HTTP
// header LABEL at convex/mcpLimit.ts:13, `x-launchsense-usage-key`, fired
// `secret.credential-pattern` high under the constant-style name `USAGE_KEY_HEADER`.
// A lowercase hyphenated slug under a constant-style name is a label. The same shape
// under `password` is a passphrase, so the name is part of that one question.

/** Provider and format shapes. A match here is strong evidence, so entropy is skipped. */
export const PROVIDER_SHAPES: RegExp[] = [
  /\b(AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/,                    // AWS access key id
  /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/,                // GitHub classic token
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,                          // GitHub fine-grained
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,                          // Slack
  /\b(sk_live_|sk_test_|rk_live_)[A-Za-z0-9]{10,}/,          // Stripe
  /\bsk-ant-[A-Za-z0-9-]{10,}/,                              // Anthropic
  /\bsk-or-v1-[A-Za-z0-9]{16,}/,                             // OpenRouter
  /\bsk-[A-Za-z0-9]{20,}/,                                   // OpenAI and clones
  /\bAIza[0-9A-Za-z_-]{30,}/,                                // Google API key
  /\bya29\.[A-Za-z0-9_-]{10,}/,                              // Google OAuth
  /\bSG\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,            // SendGrid
  /\bSK[0-9a-f]{32}\b/i,                                     // Twilio
  /\bglpat-[A-Za-z0-9_-]{16,}/,                              // GitLab
  /\bdop_v1_[a-f0-9]{64}\b/,                                 // DigitalOcean
  /\bnpm_[A-Za-z0-9]{30,}/,                                  // npm
  /\bwhsec_[A-Za-z0-9]{20,}/,                                // Stripe webhook
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/,                  // PEM block
];

/** Exact values that are never a secret, whatever the variable is called. */
const PLACEHOLDER_VALUES = new Set([
  "", "changeme", "change_me", "change-me", "changethis", "changeit", "change_password",
  "placeholder", "your_key", "your-key", "yourkey", "your_key_here", "your_api_key",
  "your-api-key", "your_password_here", "your_secret_here", "your_token_here",
  "enter_your_key", "enter-key-here", "insert_your_key", "replace_me", "replace-this",
  "replace_with_yours", "override-me", "your-key-here",
  "todo", "tbd", "fixme", "xxx", "xxxx", "xxxxx", "******", "***", "...", "---", "___",
  "redacted", "dummy", "example", "sample", "mock", "fake", "stub", "test", "testing",
  "demo", "none", "null", "undefined", "nan", "nil", "empty", "default", "unimplemented",
  "secret", "password", "passwd", "pass", "pwd", "key", "token", "apikey", "api_key",
  "api-key", "mykey", "my_key", "mysecret", "my_secret", "my_password", "my-token",
  "foo", "bar", "baz", "hello", "world", "helloworld", "asdf", "asdf1234",
  "qwerty", "letmein", "admin", "admin123", "root", "user",
  "abc", "abcd", "abc123", "password1", "password123", "hunter2", "welcome1",
  "base", "extended", "secretpassword", "string", "number", "boolean", "object",
  "true", "false", "required", "development", "production",
]);

function countClasses(value: string): number {
  let n = 0;
  if (/[a-z]/.test(value)) n++;
  if (/[A-Z]/.test(value)) n++;
  if (/[0-9]/.test(value)) n++;
  if (/[^A-Za-z0-9]/.test(value)) n++;
  return n;
}

function distinctChars(value: string): number {
  return new Set(value).size;
}

/** UUID, hash digest, ISO date, or version. Identifiers, never credentials. */
function isKnownIdentifier(value: string): boolean {
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value)) return true;
  if (/^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$/.test(value)) return true; // bcrypt
  if (/^\$argon2[a-z0-9]*\$/.test(value)) return true;
  if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?/.test(value)) return true; // ISO date
  if (/^v?\d+\.\d+\.\d+([.-][A-Za-z0-9]+)*$/.test(value)) return true; // version
  return false;
}

/** A reference or a computed value, never a literal written into the source. */
function isReferenceOrExpression(value: string): boolean {
  if (/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(value)) return false; // PEM is a literal
  if (/^[$%]/.test(value)) return true;                             // shell, PowerShell
  if (/^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/.test(value)) return true; // a.b
  if (/[{}[\]]/.test(value)) return true;                          // containers, generics
  if (/\s/.test(value)) return true;                               // prose has spaces
  if (/^(https?|postgres|postgresql|mysql|mongodb|redis):\/\//i.test(value)) return true;
  if (/^(\.{0,2}\/|[A-Za-z]:\\)/.test(value)) return true;         // path
  return false;
}

/**
 * Does the name the value sits under declare a constant rather than a credential?
 *
 * `USAGE_KEY_HEADER` is SCREAMING_SNAKE_CASE, and any name ending in HEADER, NAME, or
 * LABEL declares the label of something rather than the secret itself. A slug belongs
 * under such a name.
 *
 * Deliberately about the NAME only. A value under a constant-style name is still judged
 * on its own shape, so a base64 run, a hex digest, a JWT, or a provider key assigned to
 * `SOME_KEY` still fires. Only a clean lowercase hyphenated slug is exempt, and only
 * under a name shaped like this one.
 */
function isConstantStyleName(name: string): boolean {
  if (name.length === 0) return false;
  if (/^[A-Z][A-Z0-9_]*$/.test(name)) return true;
  const tail = name.split(/[_\-]/).pop() ?? name;
  return /^(?:header|name|label)$/i.test(tail);
}

/**
 * A lowercase hyphenated slug made of plain words: `x-launchsense-usage-key`,
 * `rendered-phone-check`. No digit is allowed, on purpose. A label is spelled out in
 * words; a value carrying digits looks generated. That is what keeps
 * `API_KEY = "sk-abcd1234efgh5678"` firing, which a looser slug rule silently lost.
 */
const LOWERCASE_SLUG = /^[a-z]+(?:-[a-z]+)+$/;

/**
 * True when the value itself looks like a credential.
 *
 * `wasQuoted` matters: a quoted literal is the only place a short secret can live,
 * while a bare token shorter than 12 characters is almost always an identifier.
 *
 * `name` is the variable the value is assigned to, when the caller knows it. It is
 * optional and defaults to empty, which means no exemption at all, so every existing
 * caller keeps judging the value on its own.
 */
export function looksLikeSecretValue(value: string, wasQuoted = true, name = ""): boolean {
  const t = value.trim();
  if (t.length === 0) return false;

  // Provider formats are checked FIRST, before any structural rejection, because a
  // real key can look like a reference or an expression. `ya29.a0Af...`, `SG.a.b`, and
  // a JWT all contain dots, and rejecting dotted values before this point caused a
  // false negative on all three.
  for (const shape of PROVIDER_SHAPES) {
    if (shape.test(t)) return true;
  }
  if (/^[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/.test(t)) return true; // JWT

  const low = t.toLowerCase();
  if (PLACEHOLDER_VALUES.has(low)) return false;
  if (/^(.)\1{3,}$/.test(t)) return false;                          // aaaa, xxxx, 0000
  if (/^(x{3,}|\*{3,}|\.{3,}|-{3,}|_{3,})$/i.test(t)) return false; // masks and elisions
  if (/^(1234+|abcd+|qwerty+|asdf+)[0-9]*$/i.test(t)) return false; // keyboard runs
  if (/[<[{][^<[{\]}]*?(your|enter|insert|replace|change|example|key|secret|password|token)[^>\]}]*[>\]}]/i.test(t)) {
    return false;                                                   // <your-key-here>
  }
  if (isKnownIdentifier(t)) return false;
  if (isReferenceOrExpression(t)) return false;

  // An EVM address is public, checksummed hex, and appears in every contract call
  // and block explorer. It is not a credential. Found on 2026-10-04 when a contract
  // address in a crypto backend was flagged.
  if (/^0x[0-9a-fA-F]{40}$/.test(t)) return false;

  // A lowercase snake identifier is a name, not a secret. `rendered_phone_check`
  // as a value is the feature it names, the same way `token_address` is. A real
  // credential is a hash, a base64 run, or a prefixed key, never a clean snake name.
  if (/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(t)) return false;

  // The kebab-case sibling of that rule, and the only shape here judged together with
  // the NAME it sits under. `USAGE_KEY_HEADER = "x-launchsense-usage-key"` is the name
  // of an HTTP header, and the real secret is read from the environment behind it. The
  // same shape under `password` is a passphrase, so the exemption needs a
  // constant-style name.
  //
  // Placed after the provider shapes above on purpose. `sk-or-v1-...` is itself slug
  // shaped, so this rule must never run first or it swallows a real OpenRouter key.
  if (name.length > 0 && isConstantStyleName(name) && LOWERCASE_SLUG.test(t)) return false;

  // A relative path is a file location, not a secret. `dist/bin.cjs` in a lockfile
  // is a build output path. But the base64 alphabet includes `/`, so a base64
  // secret can look path-shaped (a 64-char `secret_key_base` with one `/`). Only
  // reject a path when the value is not a mixed-case base64 run, or a real key is
  // lost. Provider shapes bypass all of this above.
  const base64Shaped = /^[A-Za-z0-9+/]{20,}={0,2}$/.test(t) && /[A-Z]/.test(t);
  if (!base64Shaped && /^[A-Za-z0-9_.@-]+(\/[A-Za-z0-9_.@-]+)+$/.test(t)) return false;

  // A bare value that is a valid identifier is a name, not a secret.
  // `token_address`, `encrypted_secret`, `SARA_MODEL` are all references or config
  // names. A credential written without quotes is a hash, a base64 run, a prefixed
  // key, or an address, never a clean identifier.
  if (!wasQuoted) {
    // Pure hex of credential length is a real shape, so it is allowed through.
    const isHex = /^[0-9a-fA-F]{16,}$/.test(t) && new Set(t.toLowerCase()).size > 4;
    if (!isHex && /^[A-Za-z_][A-Za-z0-9_]*$/.test(t)) return false;
  }
  // A quoted SCREAMING_SNAKE_CASE name with no digit is a constant or a config key,
  // not a secret. `SARA_MODEL`, `MY_KEY`, `API_KEY` as a value are all names.
  if (wasQuoted && /^[A-Z][A-Z0-9_]*$/.test(t) && !/[0-9]/.test(t)) return false;

  // The generic floor. A quoted literal may be shorter; a bare value may not.
  const floor = wasQuoted ? 8 : 12;
  if (t.length < floor) return false;

  const classes = countClasses(t);
  const distinct = distinctChars(t);

  if (t.length >= 20 && distinct >= 10) return true;
  if (t.length >= 12 && classes >= 2 && distinct >= 8) return true;
  if (wasQuoted && t.length >= 8 && classes >= 3 && distinct >= 6) return true;
  return false;
}
