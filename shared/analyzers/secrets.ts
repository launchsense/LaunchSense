// Deterministic secret signals. Pure: takes file paths and contents, returns
// raw matches. The persistence layer redacts snippets and hashes content
// before anything is stored. Findings carry paths and line numbers only.
//
// Two gates must both pass before a hardcoded-credential finding is raised: the
// NAME must look like a credential, and the VALUE must look like a credential. The
// value gate lives in ./secretValue.ts.

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
  // A JWT anywhere on the line.
  if (/[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(line)) return true;
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
): void {
  if (out.length < MAX_MATCHES_PER_FILE) out.push(match);
}

// Noisy rules report once per file. Forty console calls in one file is one
// line item for the builder, not forty.
function pushOncePerFile(
  out: RawSecretMatch[],
  match: RawSecretMatch,
): void {
  const already = out.some((m) => m.ruleId === match.ruleId && m.path === match.path);
  if (already) return;
  pushCapped(out, match);
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

      if (/AKIA[0-9A-Z]{16}/.test(line)) {
        pushCapped(out, {
          ruleId: client ? "secret.client-exposure" : "secret.aws-key",
          path: file.path,
          line: lineNo,
          snippet: line.trim(),
        });
        continue;
      }
      if (/((ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/.test(line)) {
        pushCapped(out, {
          ruleId: client ? "secret.client-exposure" : "secret.github-token",
          path: file.path,
          line: lineNo,
          snippet: line.trim(),
        });
        continue;
      }
      if (/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(line)) {
        pushCapped(out, {
          ruleId: client ? "secret.client-exposure" : "secret.private-key",
          path: file.path,
          line: lineNo,
          snippet: line.trim(),
        });
        continue;
      }
      if (isHardcodedCredential(line)) {
        pushCapped(out, {
          ruleId: client ? "secret.client-exposure" : "secret.credential-pattern",
          path: file.path,
          line: lineNo,
          snippet: line.trim(),
        });
        continue;
      }
      if (line.length <= 500 && /\beval\s*\(/.test(line)) {
        pushCapped(out, {
          ruleId: "secret.eval-use",
          path: file.path,
          line: lineNo,
          snippet: line.trim(),
        });
        continue;
      }
      // A debugger statement halts execution for whoever opens the app, so it
      // stays at medium. It must be a real statement, not the bare word in a
      // comment, string, or rule definition, otherwise the checker flags its
      // own documentation.
      if (line.length <= 500 && /^[\s;{}]*debugger[\s;]*$/i.test(line.trim())) {
        pushCapped(out, {
          ruleId: "secret.debugger-statement",
          path: file.path,
          line: lineNo,
          snippet: line.trim(),
        });
        continue;
      }
      if (line.length <= 500 && /console\.(log|debug|trace)\s*\(/.test(line)) {
        pushOncePerFile(out, {
          ruleId: "secret.debug-leftover",
          path: file.path,
          line: lineNo,
          snippet: line.trim(),
        });
        continue;
      }
      if (
        line.length <= 300 &&
        /\bSELECT\b.+?\bFROM\b/i.test(line)
      ) {
        pushCapped(out, {
          ruleId: "secret.sql-pattern",
          path: file.path,
          line: lineNo,
          snippet: line.trim(),
        });
      }
    }
  }

  return out;
}
