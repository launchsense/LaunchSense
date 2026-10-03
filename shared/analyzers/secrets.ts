// Deterministic secret signals. Pure: takes file paths and contents, returns
// raw matches. The persistence layer redacts snippets and hashes content
// before anything is stored. Findings carry paths and line numbers only.

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

// Values that are never a real secret, even when the name looks like one.
// A placeholder reads as a "value" to a naive pattern. Flagging it is a false
// positive, which in a security tool is worse than a miss: it teaches the reader
// to ignore the tool.
const PLACEHOLDER_VALUES = new Set([
  "changeme", "change_me", "placeholder", "your_key", "your-key", "yourkey", "your_key_here",
  "todo", "tbd", "xxx", "xxxx", "redacted", "dummy", "example", "sample",
  "none", "null", "undefined", "nil", "empty",
]);

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

  // Name looks like a credential, followed by an assignment.
  const head = /(password|passwd|pwd|secret|api[_-]?key|auth[_-]?token|access[_-]?token|client[_-]?secret)\s*[:=]\s*/i.exec(line);
  if (head === null) return false;

  let rest = line.slice(head.index + head[0].length).trim();
  rest = stripTypeAnnotation(rest);
  rest = unwrapTypeCast(rest);

  // Read from the environment or injected by CI is not hardcoded.
  if (/^(process\.env|os\.getenv|os\.environ|getenv|sys\.environ|\$\{\{|\$\{)/.test(rest)) return false;

  // Take the value: a quoted string, or the first bare token.
  const quoted = /^(['"])(.*?)\1/.exec(rest);
  const value = quoted !== null ? quoted[2] : (rest.split(/[\s;,)]/)[0] ?? "");

  if (value.length < 3) return false;
  if (PLACEHOLDER_VALUES.has(value.toLowerCase())) return false;

  // A bare value that is a qualified name is a REFERENCE, not a literal.
  // `body.cdp_key_secret`, `page.encrypted_secret`, `self.token`. Only applies when
  // the value was NOT quoted: a quoted dotted string is still a literal.
  if (quoted === null) {
    if (/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(value)) return false;
    if (/^[A-Za-z_][A-Za-z0-9_]*\(/.test(rest)) return false;
    // A function or method call on the right side is a value computed at runtime.
    if (/^[A-Za-z_][A-Za-z0-9_.]*\s*\(/.test(value) || /\b[A-Za-z_][A-Za-z0-9_.]*\(/.test(rest)) return false;
    if (/^(self|cls|body|page|row|req|request|payload|config)\b/.test(value)) return false;
    // A bare identifier with no digit and no symbol is a name, not a secret.
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
      const hasDigit = /[0-9]/.test(value);
      const hasMixedCase = /[a-z]/.test(value) && /[A-Z]/.test(value);
      if (!hasDigit && !hasMixedCase) return false;
    }
  }

  // A line that reads as prose rather than code: a sentence-ending colon followed by
  // words, or a full sentence the code cannot assign. This is a heuristic and it is
  // deliberately narrow, because a false negative on a secret is worse than a false
  // positive. It catches prose inside a multi-line string, which is where the last
  // false positive on 2026-10-04 came from.
  if (/:\s+it'?s\s|\b(it'?s|there'?s|doesn'?t|isn'?t|won'?t)\b/i.test(rest)) return false;

  return true;
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

export function scanSecrets(files: ScannedFile[]): RawSecretMatch[] {
  const out: RawSecretMatch[] = [];

  for (const file of files) {
    const base = basename(file.path);
    // Tracked environment files leak to everyone with repo access.
    // .env.example is a template and is explicitly not flagged.
    if (base.startsWith(".env") && base !== ".env.example") {
      out.push({
        ruleId: "secret.tracked-env",
        path: file.path,
        line: 1,
        snippet: "tracked environment file present",
      });
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
