// The governance file, `.ls/policy.yaml`.
//
// It is the repo's own memory: the findings a person has already looked at and
// accepted, with a reason, so a later scan does not raise them again. It is
// declarative only. It cannot execute anything, disable a rule, change a
// severity, or invent a finding. A rule that is not on this list is never
// suppressed, so accepting one finding never hides the next one.
//
// The file is refused whole when it is wrong, and then nothing is suppressed. A
// file that could silence everything is not a governance file, and this module
// exists so one cannot be used as a blindfold.
//
// Pure: no filesystem, no network, no clock. The caller reads the text and
// writes the result; everything here is a decision about that text.

import { KNOWN_RULE_IDS } from "../policies/severity.ts";

export interface GovAccept {
  fingerprint: string | null;
  ruleId: string | null;
  path: string | null;
  reason: string;
}

export interface GovPolicy {
  version: number;
  accepts: GovAccept[];
  standards: Array<{ id: string; version: string | null }>;
  licenceAllow: string[];
  ignorePaths: Array<{ path: string; reason: string }>;
  consentNoticeVersion: string | null;
}

export type GovRefusalReason =
  | "not_a_mapping"
  | "tab_indentation"
  | "anchors_not_supported"
  | "multi_document_not_supported"
  | "unsupported_version"
  | "unknown_key"
  | "accept_without_fingerprint_or_rule"
  | "accept_wildcard"
  | "accept_without_reason"
  | "accept_unknown_rule"
  | "accept_malformed_fingerprint"
  | "ignore_all_paths"
  | "ignore_without_reason"
  | "line_unreadable";

export interface GovRefusal {
  ok: false;
  reason: GovRefusalReason;
  detail: string;
}

export type GovParseResult = { ok: true; policy: GovPolicy } | GovRefusal;

const SUPPORTED_VERSION = 1;
const TOP_KEYS = new Set(["version", "accepts", "standards", "licences", "ignorePaths", "consent"]);
const FINGERPRINT_SHAPE = /^[a-z0-9.-]+:[A-Za-z0-9._-]+:[^:]+:[0-9a-f]{8}(:\d+)?$/;
const SPDX_SHAPE = /^[A-Za-z0-9.+-]+$/;
const MAX_SUPPRESSED_PER_ACCEPT = 0.5;
const MAX_SUPPRESSED_TOTAL = 0.8;

class Refused extends Error {
  readonly reason: GovRefusalReason;
  constructor(reason: GovRefusalReason, detail: string) {
    super(detail);
    this.reason = reason;
  }
}

/** A scalar with its surrounding quotes removed, or the raw text. */
function scalar(raw: string): string | number | boolean {
  const text = raw.trim();
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^-?\d+$/.test(text)) return Number(text);
  if (text.startsWith('"')) {
    if (!text.endsWith('"') || text.length < 2) throw new Refused("line_unreadable", `unterminated quote: ${raw}`);
    return text
      .slice(1, -1)
      .split('\\"')
      .join('"')
      .split("\\\\")
      .join("\\");
  }
  return text;
}

/**
 * Remove an inline comment, respecting quotes. A `#` inside a quoted value is
 * part of the value; a `#` after a space outside quotes starts a comment. Without
 * this, `path: src/x # note` would be stored as the literal path
 * `src/x # note`, an ignore that silently matches nothing.
 */
function stripComment(line: string): string {
  let inQuote = false;
  for (let at = 0; at < line.length; at += 1) {
    const ch = line[at];
    if (ch === '"' && line[at - 1] !== "\\") inQuote = !inQuote;
    else if (ch === "#" && !inQuote && (at === 0 || line[at - 1] === " " || line[at - 1] === "\t")) {
      return line.slice(0, at);
    }
  }
  return line;
}

interface Line {
  indent: number;
  text: string;
}

/**
 * A strict parser for the small shape this file uses: top-level keys, lists of
 * scalars, lists of maps, and one nested map. Anything else is refused. Anchors,
 * aliases, tags, and multi-document files are refused by name rather than
 * half-read, because a governance file is not a place to be clever.
 */
function parseLines(text: string): Record<string, unknown> {
  const raw = text.replace(/^\uFEFF/, "").split("\n");
  const lines: Line[] = [];
  for (const line of raw) {
    if (line.includes("\t")) throw new Refused("tab_indentation", "a tab was used for indentation");
    const cleaned = stripComment(line);
    const trimmed = cleaned.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith("---") || trimmed.startsWith("...")) {
      throw new Refused("multi_document_not_supported", "multiple documents are not read");
    }
    if (/(:\s*|^)[&*!]/.test(trimmed)) {
      throw new Refused("anchors_not_supported", "anchors, aliases, and tags are not read");
    }
    const indent = cleaned.length - cleaned.trimStart().length;
    lines.push({ indent, text: trimmed });
  }

  let at = 0;
  function parseBlock(indent: number): unknown {
    // A block is a list when the first line at this indent starts with "- ".
    if (lines[at] !== undefined && lines[at].indent === indent && lines[at].text.startsWith("-")) {
      const list: unknown[] = [];
      while (at < lines.length && lines[at].indent === indent && lines[at].text.startsWith("-")) {
        const item = lines[at].text.slice(1).trim();
        at += 1;
        if (item.length === 0) {
          list.push(parseBlock(indent + 2));
          continue;
        }
        const colon = item.indexOf(":");
        if (colon === -1) {
          list.push(scalar(item));
          continue;
        }
        // A map item: the first pair is inline, the rest are indented under it.
        const map: Record<string, unknown> = {};
        const key = item.slice(0, colon).trim();
        const rest = item.slice(colon + 1).trim();
        map[key] = rest.length === 0 ? parseBlock(indent + 4) : scalar(rest);
        while (at < lines.length && lines[at].indent > indent && !lines[at].text.startsWith("-")) {
          const pair = lines[at].text;
          const c = pair.indexOf(":");
          if (c === -1) throw new Refused("line_unreadable", `expected key: value, got ${pair}`);
          const k = pair.slice(0, c).trim();
          const v = pair.slice(c + 1).trim();
          const nestedIndent = lines[at].indent;
          at += 1;
          map[k] = v.length === 0 ? parseBlock(nestedIndent + 2) : scalar(v);
        }
        list.push(map);
      }
      return list;
    }

    const map: Record<string, unknown> = {};
    while (at < lines.length && lines[at].indent === indent) {
      const text = lines[at].text;
      const colon = text.indexOf(":");
      if (colon === -1) throw new Refused("line_unreadable", `expected key: value, got ${text}`);
      const key = text.slice(0, colon).trim();
      const rest = text.slice(colon + 1).trim();
      at += 1;
      if (rest.length === 0) {
        map[key] = at < lines.length && lines[at].indent > indent ? parseBlock(lines[at].indent) : null;
      } else if (rest === "[]") {
        map[key] = [];
      } else if (rest === "{}") {
        map[key] = {};
      } else {
        map[key] = scalar(rest);
      }
    }
    return map;
  }

  const parsed = parseBlock(0);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Refused("not_a_mapping", "the file must be a mapping of keys to values");
  }
  // Every line must have been read. A mis-indented block would otherwise be
  // dropped in silence, and a person would believe an acceptance is in force
  // that the parser never saw.
  if (at < lines.length) {
    throw new Refused("line_unreadable", `the file has a line the parser did not read: ${lines[at].text}`);
  }
  return parsed as Record<string, unknown>;
}

function asArray(value: unknown, key: string): unknown[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new Refused("line_unreadable", `${key} must be a list`);
  return value;
}

function asString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

export function parseGovernance(text: string): GovParseResult {
  let doc: Record<string, unknown>;
  try {
    doc = parseLines(text);
  } catch (error) {
    if (error instanceof Refused) return { ok: false, reason: error.reason, detail: error.message };
    return { ok: false, reason: "line_unreadable", detail: "the file could not be read" };
  }

  try {
    for (const key of Object.keys(doc)) {
      if (!TOP_KEYS.has(key)) throw new Refused("unknown_key", `${key} is not a key this file defines`);
    }
    const version = doc["version"];
    if (version !== SUPPORTED_VERSION) {
      throw new Refused("unsupported_version", `version must be ${SUPPORTED_VERSION}`);
    }

    const accepts: GovAccept[] = [];
    for (const entry of asArray(doc["accepts"], "accepts")) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        throw new Refused("line_unreadable", "an accepts entry must be a mapping");
      }
      const record = entry as Record<string, unknown>;
      const fingerprint = asString(record["fingerprint"]);
      const ruleId = asString(record["ruleId"]);
      const path = asString(record["path"]);
      const reason = asString(record["reason"]);
      if (fingerprint === null && ruleId === null) {
        throw new Refused("accept_without_fingerprint_or_rule", "an accepts entry needs a fingerprint or a ruleId");
      }
      if (fingerprint === "*" || ruleId === "*" || path === "*" || path === "/" || path === "**" || path === "/**") {
        throw new Refused("accept_wildcard", "a wildcard accept would suppress everything");
      }
      if (reason === null || reason.trim().length === 0) {
        throw new Refused("accept_without_reason", "an accepted finding needs a reason");
      }
      if (fingerprint !== null && !FINGERPRINT_SHAPE.test(fingerprint)) {
        throw new Refused("accept_malformed_fingerprint", `not a fingerprint: ${fingerprint}`);
      }
      if (ruleId !== null && !KNOWN_RULE_IDS.has(ruleId)) {
        throw new Refused("accept_unknown_rule", `${ruleId} is not a rule this product has`);
      }
      accepts.push({ fingerprint, ruleId, path, reason: reason.trim() });
    }

    const standards: Array<{ id: string; version: string | null }> = [];
    for (const entry of asArray(doc["standards"], "standards")) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        throw new Refused("line_unreadable", "a standards entry must be a mapping");
      }
      const record = entry as Record<string, unknown>;
      const id = asString(record["id"]);
      if (id === null || id.trim().length === 0) {
        throw new Refused("line_unreadable", "a standards entry needs an id");
      }
      standards.push({ id: id.trim(), version: asString(record["version"]) });
    }

    const licenceAllow: string[] = [];
    const licences = doc["licences"];
    if (licences !== undefined && licences !== null) {
      if (typeof licences !== "object" || Array.isArray(licences)) {
        throw new Refused("line_unreadable", "licences must be a mapping");
      }
      for (const value of asArray((licences as Record<string, unknown>)["allow"], "licences.allow")) {
        const id = asString(value);
        if (id === null || !SPDX_SHAPE.test(id)) {
          throw new Refused("line_unreadable", `${String(value)} is not an SPDX id`);
        }
        licenceAllow.push(id);
      }
    }

    const ignorePaths: Array<{ path: string; reason: string }> = [];
    for (const entry of asArray(doc["ignorePaths"], "ignorePaths")) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        throw new Refused("line_unreadable", "an ignorePaths entry must be a mapping");
      }
      const record = entry as Record<string, unknown>;
      const path = asString(record["path"]);
      const reason = asString(record["reason"]);
      if (path === null || path === "" || path === "/" || path === "**" || path === "/**") {
        throw new Refused("ignore_all_paths", "an ignore entry cannot cover the whole repo");
      }
      if (reason === null || reason.trim().length === 0) {
        throw new Refused("ignore_without_reason", "an ignored path needs a reason");
      }
      ignorePaths.push({ path, reason: reason.trim() });
    }

    let consentNoticeVersion: string | null = null;
    const consent = doc["consent"];
    if (consent !== undefined && consent !== null) {
      if (typeof consent !== "object" || Array.isArray(consent)) {
        throw new Refused("line_unreadable", "consent must be a mapping");
      }
      consentNoticeVersion = asString((consent as Record<string, unknown>)["noticeVersion"]);
    }

    return {
      ok: true,
      policy: { version: SUPPORTED_VERSION, accepts, standards, licenceAllow, ignorePaths, consentNoticeVersion },
    };
  } catch (error) {
    if (error instanceof Refused) return { ok: false, reason: error.reason, detail: error.message };
    return { ok: false, reason: "line_unreadable", detail: "the file could not be validated" };
  }
}

export interface GovFinding {
  ruleId: string;
  fingerprint: string;
  path: string;
}

export interface GovApplyResult {
  suppressed: GovFinding[];
  kept: GovFinding[];
  /** True when the file would silence too much to believe. */
  sandbag: boolean;
}

function matchesAccept(accept: GovAccept, finding: GovFinding): boolean {
  if (accept.fingerprint !== null) return accept.fingerprint === finding.fingerprint;
  if (accept.ruleId !== null && accept.path !== null) {
    return accept.ruleId === finding.ruleId && accept.path === finding.path;
  }
  return accept.ruleId === finding.ruleId;
}

function isIgnored(policy: GovPolicy, finding: GovFinding): boolean {
  return policy.ignorePaths.some(
    (entry) => finding.path === entry.path || finding.path.startsWith(`${entry.path}/`),
  );
}

/**
 * Apply the file to the findings. A finding is suppressed only when an acceptance
 * names it or an ignored path covers it, and nothing else is hidden.
 *
 * The sandbag check runs here, over the ORIGINAL findings, and it counts ignored
 * paths as suppression. That is the point: a file that hides a whole repo through
 * a long list of ignored directories must trip it the same way a long list of
 * acceptances would, or the guard is a guard against one door and not the other.
 * When `sandbag` is true the caller suppresses nothing, so the returned lists are
 * only meaningful when it is false.
 */
export function applyGovernance<T extends GovFinding>(findings: readonly T[], policy: GovPolicy): GovApplyResult {
  const suppressed: GovFinding[] = [];
  const kept: GovFinding[] = [];
  for (const finding of findings) {
    const accepted = policy.accepts.some((accept) => matchesAccept(accept, finding));
    if (accepted || isIgnored(policy, finding)) suppressed.push(finding);
    else kept.push(finding);
  }

  const total = findings.length;
  let sandbag = false;
  if (total > 0) {
    for (const accept of policy.accepts) {
      const byThis = findings.filter((finding) => matchesAccept(accept, finding)).length;
      if (byThis / total > MAX_SUPPRESSED_PER_ACCEPT) sandbag = true;
    }
    const ignoredCount = findings.filter((finding) => isIgnored(policy, finding)).length;
    if (ignoredCount / total > MAX_SUPPRESSED_PER_ACCEPT) sandbag = true;
    if (suppressed.length / total > MAX_SUPPRESSED_TOTAL) sandbag = true;
  }
  return { suppressed, kept, sandbag };
}
