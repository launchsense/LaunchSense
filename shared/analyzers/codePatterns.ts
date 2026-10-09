// Fixed code patterns. These are shapes in the text, not proof that a line is
// reachable or that an attack works. Old secret.* ids stay in the severity map
// so a stored finding still scores. New findings use code.*.

export interface CodeHit {
  ruleId: string;
  oncePerFile: boolean;
}

// The deprecated createCipher API derives its own key and IV from a password,
// and Node marks it deprecated, so any algorithm passed through it is a weak
// cipher call. `createCipheriv` is the modern API and only weak when its
// algorithm is broken today. The names are matched on word boundaries inside
// the quoted argument, so a modern `aes-256-gcm` and a word like `deserialize`
// are not weak ciphers, while `des-cbc`, `des3`, `bf-cbc`, and `aes-128-ecb`
// are. The original blanket `createCipheriv(["'])` flagged every modern cipher.
const DEPRECATED_CIPHER_API = /createCipher\s*\(\s*['"]/i;
const WEAK_CIPHER_ALGORITHM =
  /createCipheriv\s*\(\s*['"][^'"]*\b(?:des|des3|3des|rc4|rc2|bf|blowfish|ecb)\b[^'"]*['"]/i;

/** The line length above which no code-shape rule is evaluated. */
export const CODE_PATTERN_MAX_LINE = 500;

/**
 * True when this line is over the code-shape line cap and was skipped by these
 * rules. The gate itself is unchanged: a long line was never read by
 * matchCodePattern. This exists so the skip is countable, and a countable skip
 * can be disclosed, instead of reading as "nothing was there".
 */
export function codePatternSkippedLine(line: string): boolean {
  return line.length > CODE_PATTERN_MAX_LINE;
}

export function matchCodePattern(line: string): CodeHit | null {
  if (codePatternSkippedLine(line)) return null;
  // A comment describes code, it is not code. Every rule below is a shape in
  // source, and a line whose first non-space character opens a comment is
  // prose about a shape, not the shape. This gate is what stops a README or a
  // doc comment ("// do not use eval(x) here") from raising a finding, and a
  // high one at that. Trailing comments after real code still count: the line
  // does not start with a comment marker.
  const trimmed = line.trim();
  const isComment =
    trimmed.startsWith("//") ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("--");
  if (isComment) {
    // The one exception: a credential or key written inside a comment is still
    // a committed secret, but those are found by the secrets analyzer, not by
    // these code-shape rules. Nothing here fires on a comment line.
    return null;
  }
  if (/\beval\s*\(/.test(line)) return { ruleId: "code.eval-use", oncePerFile: false };
  if (/^[\s;{}]*debugger[\s;]*$/i.test(line.trim())) {
    return { ruleId: "code.debugger-statement", oncePerFile: false };
  }
  if (/console\.(log|debug|trace)\s*\(/.test(line)) {
    return { ruleId: "code.debug-leftover", oncePerFile: true };
  }
  if (line.length <= 300) {
    // Uppercase only, with a table-ish token after FROM. Lowercase prose
    // ("select an option from the menu") and a bare "FROM." with no table
    // do not match. A table can be quoted, bracketed, or backtick-wrapped, and in
    // JSON-escaped text a backslash sits before the quote, so allow a short run of
    // those characters before the identifier. One hit per file: a review note.
    if (/\bSELECT\b[^;'"]{1,200}?\bFROM\s+[\\"'`[]*[A-Za-z_][A-Za-z0-9_.]*/.test(line)) {
      return { ruleId: "code.sql-pattern", oncePerFile: true };
    }
  }
  if (/\.innerHTML\s*=/.test(line)) return { ruleId: "code.inner-html", oncePerFile: false };
  if (/(?:require\(\s*['"](?:node:)?child_process['"]|from\s+['"](?:node:)?child_process['"])|\bexecSync\s*\(|\bexecFile(?:Sync)?\s*\(/.test(line)) {
    return { ruleId: "code.child-process", oncePerFile: false };
  }
  if (/createHash\s*\(\s*['"](?:md5|sha1)['"]/i.test(line) || DEPRECATED_CIPHER_API.test(line) || WEAK_CIPHER_ALGORITHM.test(line)) {
    return { ruleId: "code.weak-crypto", oncePerFile: false };
  }
  if (/Access-Control-Allow-Origin['"]?\s*[:=]\s*['"]\*['"]|origin\s*:\s*['"]\*['"]/.test(line)) {
    return { ruleId: "code.cors-wildcard", oncePerFile: true };
  }
  return null;
}
