// Deterministic secret signals. Pure: takes file paths and contents, returns
// raw matches. The persistence layer redacts snippets and hashes content
// before anything is stored. Findings carry paths and line numbers only.
//
// Two gates must both pass before a hardcoded-credential finding is raised: the
// NAME must look like a credential, and the VALUE must look like a credential. The
// value gate lives in ./secretValue.ts.

import { matchCodePattern } from "./codePatterns.ts";
import { looksLikeSecretValue, PROVIDER_SHAPES } from "./secretValue.ts";

export interface ScannedFile {
  path: string;
  content: string;
}

export interface RawSecretMatch {
  ruleId: string;
  path: string;
  line: number;
  snippet: string;
}

const MAX_MATCHES_PER_FILE = 20;

function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

function isClientPath(path: string): boolean {
  return path.startsWith("public/") || path.endsWith(".html");
}

/** The credential words a variable name can be built from. */
const CREDENTIAL_WORDS = new Set([
  "password", "passwd", "pwd", "pass",
  "secret", "secrets",
  "key", "keys", "apikey", "publickey", "privatekey",
  "token", "tokens",
  "credential", "credentials",
  "authorization", "auth",
]);

/**
 * Does a variable NAME refer to a credential?
 *
 * Splits on underscores, dashes, and camelCase, then checks each whole word. This is
 * why `apiKey` matches but `monkey` and `keynote` do not: the split is real, not a
 * substring search. `aws_access_key`, `OPENROUTER_API_KEY`, `client_secret`, and
 * `refresh_token` all reduce to a credential word.
 */
export function nameLooksLikeCredential(name: string): boolean {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")   // camelCase boundary
    .split(/[_\-\s]+/)
    .map((w) => w.toLowerCase())
    .filter((w) => w.length > 0);
  if (words.length === 0) return false;
  return words.some((w) => CREDENTIAL_WORDS.has(w));
}

// Known type annotations. Stripped only when they appear immediately before `=`,
// because that is a declaration, not an assignment of a secret. Kept as an explicit
// list, never a shape, so a real alphanumeric secret is not mistaken for a type.
const TYPE_NAMES = new Set([
  "str", "string", "int", "integer", "float", "bool", "boolean", "number", "bigint",
  "dict", "list", "object", "any", "unknown", "void",
]);

function stripTypeAnnotation(rest: string): string {
  const optional = /^Optional\[[^\]]*\]\s*=\s*/.exec(rest);
  if (optional !== null) return rest.slice(optional[0].length).trim();
  const named = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*/.exec(rest);
  if (named !== null && TYPE_NAMES.has(named[1].toLowerCase())) {
    return rest.slice(named[0].length).trim();
  }
  return rest;
}

// str(os.getenv("X")) -> os.getenv("X"). Only unwraps known type casts, so
// `os.getenv` itself is not touched.
function unwrapTypeCast(rest: string): string {
  const cast = /^([A-Za-z_][A-Za-z0-9_]*)\(([\s\S]*)\)$/.exec(rest);
  if (cast !== null && TYPE_NAMES.has(cast[1].toLowerCase())) return cast[2].trim();
  return rest;
}

/**
 * True only when a line assigns a LITERAL value that could be a credential.
 *
 * A hardcoded secret is a literal in the source. Anything that is a reference to
 * another value, a declaration, or a read from the environment is not.
 *
 * Shapes that are NOT secrets, every one of these seen in the wild on 2026-10-04:
 *   OPENROUTER_API_KEY: str = ""               a type annotation, empty default
 *   api_key: str = "changeme"                 a placeholder
 *   PASSWORD = os.getenv("PASSWORD", "")      read from the environment
 *   secret = Column(String, nullable=False)   an ORM column declaration
 *   cdp_key_secret=body.cdp_key_secret        a reference to another variable
 *   secret=chat_id                            a parameter reference
 *   secret: ${{ secrets.TOKEN }}              injected by CI
 */
export function isHardcodedCredential(line: string): boolean {
  // A comment mentions the word but assigns nothing.
  const trimmed = line.trim();
  if (trimmed.startsWith("#") || trimmed.startsWith("//") || trimmed.startsWith("*")) return false;

  // A provider-shaped key on the line is a credential regardless of what it is
  // assigned to, or whether it is assigned to anything at all. A bare AWS key in a
  // list, or a token passed as a positional argument, has no variable name to match.
  // This runs before the name gate because the name gate cannot see those.
  if (containsProviderKey(line)) return true;

  // Scan EVERY assignment on the line, not just the first. A line can hold an env
  // read and a real literal:
  //   const secret = process.env.SECRET, apiKey = "sk-live-a1b2c3d4e5";
  // Stopping at the first assignment lost the real key.
  const assignAll = /["']?\s*(?::(?![=:])|=(?![=>])|:=)\s*/g;
  let assign: RegExpExecArray | null;
  while ((assign = assignAll.exec(line)) !== null) {
    const before = line.slice(0, assign.index);
    const nameMatch = /([A-Za-z0-9_]+)$/.exec(before);
    if (nameMatch === null) continue;
    if (!nameLooksLikeCredential(nameMatch[1])) continue;
    // A member or attribute access is not a variable assignment. `viewBinding.tvSendCode`
    // reduces to a credential word on the LAST identifier only when the receiver is
    // dropped; here the receiver is `viewBinding.tvSendCode`, and the token before the
    // dot is the receiver. A credential word used as a field or attribute of another
    // object (a UI binding, a config member, a framework field) is not a hardcoded
    // secret. Reject when the matched name is preceded by a dot or is a known member.
    const receiver = before.slice(0, before.length - nameMatch[1].length);
    if (/[.]$/.test(receiver)) continue;
    if (/\b(?:viewBinding|databinding|binding|Binding)$/.test(receiver)) continue;
    // XML/HTML/IDE attributes: `key="..."` where the value is a path or a numeric
    // zoom. A framework attribute named `key` is not a credential assignment.
    if (/[<>]/.test(line) || /\s(?:key|value|name)\s*=\s*["']/.test(line)) continue;
    if (valueAtIsCredential(line, assign.index, assign[0].length)) return true;
  }
  return false;
}

/**
 * Any provider-shaped key anywhere in the line.
 *
 * This is deliberately independent of the variable name. A key can appear in a list,
 * as a positional argument, in a dict literal, or bare. It checks PROVIDER SHAPES
 * ONLY, never the generic entropy rule: a generic sweep would flag ORM declarations
 * and variable references, which the name gate exists to reject.
 */
export function containsProviderKey(line: string): boolean {
  for (const shape of PROVIDER_SHAPES) {
    if (shape.test(line)) return true;
  }
  // A JWT anywhere on the line. Anchored to real JWT structure: three base64url
  // segments, at least one of which must NOT be a plain dotted identifier. A bare
  // chain like `django.middleware.clickjacking.XFrameOptionsMiddleware` is not a
  // JWT; a real token has a `-` or `_` in a segment, or starts with the base64url
  // header `eyJ`. Without this, every 3-segment dotted import and member chain fired.
  const jwt = /[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g;
  let m: RegExpExecArray | null;
  while ((m = jwt.exec(line)) !== null) {
    const token = m[0];
    // A CLI flag or a dashed package path is not a JWT. Reject when the match is
    // preceded by `--` or `-`, or when any segment is a known flag word.
    const before = line.slice(Math.max(0, m.index - 2), m.index);
    if (before.includes("-")) continue;
    const segs = token.split(".");
    const hasUrlChar = segs.some((s) => /[-_]/.test(s));
    const looksBase64 = /^ey[A-Za-z0-9_-]/.test(token);
    const mixedCase = /[a-z]/.test(token) && /[A-Z]/.test(token);
    const allLowerDotted = segs.every((s) => /^[a-z][a-z0-9]*$/.test(s));
    // A JWT's three segments are base64url and contain no plain English words
    // joined by dashes. A flag like mount-points-exclude is hyphenated prose.
    const hyphenatedWords = segs.some((s) => /^[a-z]+(-[a-z]+){2,}$/.test(s));
    if (hyphenatedWords) continue;
    // Three lowercase identifiers joined by dots, with underscores or dashes, are
    // still source code (Rust/Go/CLI), not base64url. A real JWT of this length is
    // mixed case. Require mixed case for the url-char path; keep the eyJ path above.
    const allLower = !/[A-Z]/.test(token);
    if (looksBase64) return true;
    if (allLower) continue;
    if (hasUrlChar && mixedCase) return true;
    if (allLowerDotted) continue;
    if (hasUrlChar) return true;
  }
  return false;
}

/** Check the value that follows one assignment. Split out so a line can be scanned in full. */
function valueAtIsCredential(line: string, at: number, opLen: number): boolean {
  let rest = line.slice(at + opLen).trim();
  rest = stripTypeAnnotation(rest);
  rest = unwrapTypeCast(rest);

  // Read from the environment or injected by CI is not hardcoded. Covers the
  // common forms in Python, JS/TS, Go, Ruby, PHP, C#, and shell.
  if (/^(process\.env|os\.getenv|os\.environ|sys\.environ|ENV\[|getenv|_ENV\[|\$env:|configuration\[|System\.getenv|\$\{\{|\$\{|\$\(|%\w+%|\$[A-Za-z_])/i.test(rest)) return false;

  // An element of a container literal is not an assignment to the name.
  // `FEATURE_KEYS = ["rendered_phone_check"]` names the feature, it does not
  // store a credential under it. A provider-shaped value inside the container
  // still fires through `containsProviderKey` before this point.
  if (/^\s*[([{]/.test(rest)) return false;

  // An optional-chain read is a reference to another value, not a literal.
  // `tokens?.access_token` reads the field, it does not write a secret.
  if (rest.includes("?.")) return false;

  // Take the value: a quoted string anywhere at the start of the remainder, or the
  // first bare token. Leading punctuation such as `(` from `keys = ("NAME",)` is
  // stripped first, so the quote is found rather than producing a mangled token.
  const stripped = rest.replace(/^[([{]+\s*/, "");
  const quoted = /^(['"])(.*?)\1/.exec(stripped) ?? /^(['"])(.*?)\1/.exec(rest);
  const value = quoted !== null
    ? quoted[2]
    : (stripped.split(/[\s;,)]/)[0] ?? "").replace(/["',;:]+$/, "");

  // A bare value that is a qualified name is a REFERENCE, not a literal.
  if (quoted === null) {
    if (/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(value)) return false;
    if (/^[A-Za-z_][A-Za-z0-9_]*\(/.test(rest)) return false;
    if (/^[A-Za-z_][A-Za-z0-9_.]*\s*\(/.test(value) || /\b[A-Za-z_][A-Za-z0-9_.]*\(/.test(rest)) return false;
    if (/^(self|cls|body|page|row|req|request|payload|config|settings|opts|options|this)\b/.test(value)) return false;
  }

  // A line that reads as prose rather than code. Deliberately narrow, because a
  // false negative on a secret is worse than a false positive.
  if (/:\s+it'?s\s|\b(it'?s|there'?s|doesn'?t|isn'?t|won'?t)\b/i.test(rest)) return false;

  return looksLikeSecretValue(value, quoted !== null);
}

function pushCapped(
  out: RawSecretMatch[],
  match: RawSecretMatch,
  fileCount: { used: number },
): void {
  if (fileCount.used < MAX_MATCHES_PER_FILE) {
    out.push(match);
    fileCount.used++;
  }
}

// Noisy rules report once per file. Forty console calls in one file is one
// line item for the builder, not forty.
function pushOncePerFile(
  out: RawSecretMatch[],
  match: RawSecretMatch,
  fileCount: { used: number },
): void {
  const already = out.some((m) => m.ruleId === match.ruleId && m.path === match.path);
  if (already) return;
  pushCapped(out, match, fileCount);
}

/**
 * Does a tracked env file hold a VALUE that looks like a live credential?
 *
 * A tracked `.env` is only a problem when it carries real values. The common and
 * correct pattern is a tracked template with empty or placeholder values, while the
 * real secrets live in `.env.local`, which is gitignored. Flagging the template as a
 * blocking high finding is a false positive, and it was the last one standing on
 * sara-wallet on 2026-10-04, where the repo documents this pattern in CONTRIBUTING.md.
 *
 * A value counts as real when the name looks like a credential AND the value is not
 * empty and does not look like a placeholder. Config values such as a provider name, a
 * model id, or a `sqlite://` URL are not credentials.
 */
export function trackedEnvHasLiveValue(content: string): boolean {
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#") || !line.includes("=")) continue;
    const eq = line.indexOf("=");
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!nameLooksLikeCredential(key)) continue;
    if (value.length === 0) continue;
    // The same value gate the rest of the analyzer uses.
    if (looksLikeSecretValue(value, true)) return true;
  }
  return false;
}

export function scanSecrets(files: ScannedFile[]): RawSecretMatch[] {
  const out: RawSecretMatch[] = [];

  for (const file of files) {
    const base = basename(file.path);
    // A tracked environment file leaks to everyone with repo access, but only when it
    // actually carries a value. A tracked TEMPLATE with empty or placeholder values is
    // the correct pattern, and `.env.local` holds the real values outside the repo.
    if (base.startsWith(".env") && base !== ".env.example") {
      if (trackedEnvHasLiveValue(file.content)) {
        out.push({
          ruleId: "secret.tracked-env",
          path: file.path,
          line: 1,
          snippet: "tracked environment file carries a value",
        });
      }
      continue;
    }

    const lines = file.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (line.length === 0 || line.length > 2000) continue;
      const lineNo = i + 1;
      const client = isClientPath(file.path);
      const fileCount = { used: out.filter((m) => m.path === file.path).length };
      if (/AKIA[0-9A-Z]{16}/.test(line)) {
        pushCapped(out, {
          ruleId: client ? "secret.client-exposure" : "secret.aws-key",
          path: file.path,
          line: lineNo,
          snippet: line.trim(),
        }, fileCount);
        continue;
      }
      if (/((ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/.test(line)) {
        pushCapped(out, {
          ruleId: client ? "secret.client-exposure" : "secret.github-token",
          path: file.path,
          line: lineNo,
          snippet: line.trim(),
        }, fileCount);
        continue;
      }
      if (/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(line)) {
        pushCapped(out, {
          ruleId: client ? "secret.client-exposure" : "secret.private-key",
          path: file.path,
          line: lineNo,
          snippet: line.trim(),
        }, fileCount);
        continue;
      }
      if (isHardcodedCredential(line)) {
        pushCapped(out, {
          ruleId: client ? "secret.client-exposure" : "secret.credential-pattern",
          path: file.path,
          line: lineNo,
          snippet: line.trim(),
        }, fileCount);
        continue;
      }
      const code = matchCodePattern(line);
      if (code !== null) {
        const push = code.oncePerFile ? pushOncePerFile : pushCapped;
        push(out, {
          ruleId: code.ruleId,
          path: file.path,
          line: lineNo,
          snippet: line.trim(),
        }, fileCount);
      }
    }
  }

  return out;
}
