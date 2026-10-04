// Fixed code patterns. These are shapes in the text, not proof that a line is
// reachable or that an attack works. Old secret.* ids stay in the severity map
// so a stored finding still scores. New findings use code.*.

export interface CodeHit {
  ruleId: string;
  oncePerFile: boolean;
}

export function matchCodePattern(line: string): CodeHit | null {
  if (line.length > 500) return null;
  if (/\beval\s*\(/.test(line)) return { ruleId: "code.eval-use", oncePerFile: false };
  if (/^[\s;{}]*debugger[\s;]*$/i.test(line.trim())) {
    return { ruleId: "code.debugger-statement", oncePerFile: false };
  }
  if (/console\.(log|debug|trace)\s*\(/.test(line)) {
    return { ruleId: "code.debug-leftover", oncePerFile: true };
  }
  if (line.length <= 300 && /\bSELECT\b.+?\bFROM\b/i.test(line)) {
    return { ruleId: "code.sql-pattern", oncePerFile: false };
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
