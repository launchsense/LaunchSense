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
      if (
        /(password|passwd|pwd|secret|api[_-]?key|auth[_-]?token|access[_-]?token|client[_-]?secret)\s*[:=]\s*['"]?[^\s'";,]{3,}/i.test(
          line,
        )
      ) {
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
      // stays at medium. Console noise is low and capped per file below.
      if (line.length <= 500 && /\bdebugger\b/.test(line)) {
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
