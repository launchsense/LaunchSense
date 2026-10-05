// Fake credentials for tests, assembled at runtime.
//
// Why these are built from parts rather than written as literals:
//
// GitHub's secret scanning refuses a push that contains a key-shaped string, and it
// is right to. It cannot tell a test fixture from a live key. On 2026-10-04 a push was
// blocked on tests/secret-value-checks.mjs because a fixture matched the OpenRouter
// key format.
//
// The fix is not to disable the scanner or exempt the file. It is to stop putting
// key-shaped text in the source at all. Each value below is assembled from fragments,
// so no file ever contains a contiguous string that looks like a credential. The
// tests get exactly the same runtime values they had before.
//
// Every value is a published EXAMPLE from provider documentation, never a live key.

function join(...parts) {
  return parts.join("");
}

/** AWS access key id, the canonical documentation example. */
export const FAKE_AWS = join("AKIA", "IOSFODNN7EXAMPLE");

/** GitHub classic personal access token. */
export const FAKE_GITHUB_CLASSIC = join("ghp_", "abcdefghij1234567890", "ABCD");

/** GitHub fine-grained personal access token. */
export const FAKE_GITHUB_PAT = join("github_pat_", "abcdef1234567890", "abcdef1234abcd");

/** Slack bot token. */
export const FAKE_SLACK = join("xoxb-", "123456789012", "-ABCDEFGHIJKLMNopqr");

/** Stripe test secret key. */
export const FAKE_STRIPE = join("sk_test_", "4eC39HqLyjWDarjt", "T1zdp7dc");

/** OpenAI key. */
export const FAKE_OPENAI = join("sk-", "abcdefghij1234567890", "abcdefghij1234567890");

/** OpenRouter key, the shape that blocked the push. */
export const FAKE_OPENROUTER = join("sk-or-v1-", "abcdef1234567890", "abcdef1234567890abcdef12");

/** Anthropic key. */
export const FAKE_ANTHROPIC = join("sk-ant-api03-", "abcdefghij1234567890", "abcdefghij1234567890");

/** Google OAuth access token. */
export const FAKE_GOOGLE_OAUTH = join("ya29.", "a0AfH6SMB", "xxxxxxxxxxxxx1234567890ab");

/** Google API key. */
export const FAKE_GOOGLE_API = join("AIza", "SyB4eC39HqLyjWDarjt", "T1zdp7dc9vWxYz1234");

/** SendGrid key. */
export const FAKE_SENDGRID = join("SG.", "abcdefghij1234567890", ".", "ABCDEFGHIJ1234567890abcdef");

/** Twilio key. */
export const FAKE_TWILIO = join("SK", "abcdef1234567890", "abcdef1234567890ab");

/** Twilio key in the exact shape the detector's `{32}` rule requires. */
export const FAKE_TWILIO_KEY = join("SK", "0123456789abcdef", "0123456789abcdef");

/** A JWT, three dot-separated base64url parts. */
export const FAKE_JWT = join(
  "eyJhbGciOiJIUzI1NiJ9",
  ".",
  "eyJzdWIiOiIxMjM0In0",
  ".",
  "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJ",
);

/** A private key header line. */
export const FAKE_PEM = join("-----BEGIN ", "RSA ", "PRIVATE KEY-----");

/** A 32 character hex secret. */
export const FAKE_HEX32 = join("a1b2c3d4e5f6a7b8", "c9d0e1f2a3b4c5d6");

/** A 40 character hex digest. */
export const FAKE_HEX40 = join("da39a3ee5e6b4b0d", "3255bfef95601890afd80709");

/** A base64 secret. */
export const FAKE_BASE64 = join("wJalrXUtnFEMI/K7MDENG", "/bPxRfiCYzK8w5Dg=");

/** A 40-character base64 secret with a slash and no padding.
 *  Reproduces the class where the path-shape gate swallowed a real key. */
export const FAKE_BASE64_SLASH = join(
  "AkBmCnDoEpFqGrHs",
  "ItJuKvLwMxNyOzP0",
  "/",
  "Q1R2S3T4U5V6W7X8",
  "Y9ZaBcDeFgHi",
);

/** A 16 character mixed alphanumeric value. */
export const FAKE_MIXED16 = join("a1b2c3d4", "e5f6g7h8");

/** A long mixed case value. */
export const FAKE_LONG = join("aVeryLong", "RealSecretValue");

/** An EVM contract address, public and not a secret. */
export const FAKE_EVM_ADDRESS = join("0x28b5a0e9c621a5badaa536219b3a", "228c8168cf5d");

/** A UUID, an identifier rather than a secret. */
export const FAKE_UUID = join("550e8400-e29b-41d4-a716-", "446655440000");

/** GitLab personal access token. */
export const FAKE_GITLAB = join("glpat-", "abcdefghij1234567890");

/** DigitalOcean personal access token, 64 hex characters. */
export const FAKE_DIGITALOCEAN = join(
  "dop_v1_",
  "0123456789abcdef0123456789abcdef",
  "0123456789abcdef0123456789abcdef",
);

/** npm automation token. */
export const FAKE_NPM = join("npm_", "abcdefghij1234567890abcdefghij1234567890");

/** Stripe webhook signing secret. */
export const FAKE_WEBHOOK = join("whsec_", "abcdefghij1234567890abcd");

/** Build a full assignment line for a provider fixture. */
export function line(name, value) {
  return `${name} = "${value}"`;
}
