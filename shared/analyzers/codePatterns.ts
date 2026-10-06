// Fixed code patterns. These are shapes in the text, not proof that a line is
// reachable or that an attack works. Old secret.* ids stay in the severity map
// so a stored finding still scores. New findings use code.*.

export interface CodeHit {
  ruleId: string;
  oncePerFile: boolean;
}

export function matchCodePattern(line: string): CodeHit | null {
  if (line.length > 500) return null;
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
  if (/createHash\s*\(\s*['"](?:md5|sha1)['"]|createCipher(?:iv)?\s*\(\s*['"]/i.test(line)) {
    return { ruleId: "code.weak-crypto", oncePerFile: false };
  }
  if (/Access-Control-Allow-Origin['"]?\s*[:=]\s*['"]\*['"]|origin\s*:\s*['"]\*['"]/.test(line)) {
    return { ruleId: "code.cors-wildcard", oncePerFile: true };
  }
  return null;
}
