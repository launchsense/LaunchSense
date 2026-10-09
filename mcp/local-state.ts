// The local review's own state: `.ls/policy.yaml`, `.ls/reports/`, and the
// `.gitignore` line that keeps `.ls/` private.
//
// These paths used to be read and written by plain pathname. A symbolic link at
// any of those names, or a directory swapped for a link between the check and
// the open, could move a read or a write to a file outside the checkout. This
// module opens every one of them from a pinned parent directory handle, with the
// final component refusing a link, and never follows a link's target.
//
// The rules it keeps:
//   - A read or a write is always resolved from an already-open parent handle,
//     so a rename or a link replacement of the pathname cannot redirect it.
//   - The final component is opened with O_NOFOLLOW: a link at the name is a
//     refusal, not a follow. `.ls`, `.ls/policy.yaml`, `.ls/reports` and
//     `.gitignore` links are refused and disclosed.
//   - Every text read is bounded. A file over the bound is refused whole rather
//     than parsed in part.
//   - A write goes to a fresh temp file that is then renamed into place. The
//     target and the temp name are re-checked immediately before the rename, so
//     a failed write never truncates an existing file and a link at either name
//     is refused rather than replaced. This is bounded, not absolute: rename
//     takes a pathname, so a single rename call is the smallest window Node `fs`
//     can offer without a native atomic exchange, which is not used here.
//   - Absence is ordinary; a link or an unreadable file is a refusal, never a
//     silent absence.
//   - No fsync is issued, so durability across a crash is not claimed.
//
// Disclosure names a relative scope (".ls/policy.yaml"), never a handle path, so
// a report tells a person what was skipped without printing a file descriptor.

import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import type { Stats } from "node:fs";
import { directoryHandlePath } from "./root-boundary.ts";

/**
 * The most bytes this module reads from one local metadata file. The files are
 * the repo's own memory: a policy, a prior report, an ignore file. A file over
 * this bound is refused whole and disclosed, because a truncated policy parses
 * into a decision the person never wrote. This is separate from the walker's own
 * 40,000,000 byte working-tree budget.
 */
export const MAX_LOCAL_METADATA_BYTES = 1 << 20;

/**
 * The shape of a saved report filename: the run's timestamp, with the colons and
 * dots of an ISO string replaced by hyphens, then `.md`. It is the only shape
 * the engine has ever written, and it lets a reader tell a saved report from the
 * third-party notice (which also ends in `.md`) or from an unrelated file a
 * person dropped in the folder. Any file that does not match is not a report.
 */
const SAVED_REPORT_NAME = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.md$/;

/** The timestamp stamp a run uses for its saved files, so reader and writer agree. */
export function savedReportStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/** True when a filename is one the engine writes for a saved report. */
export function isSavedReportName(name: string): boolean {
  return SAVED_REPORT_NAME.test(name);
}

/** The same stamped name a run uses for its saved policy copy. */
export function savedPolicyName(stamp: string): string {
  return `${stamp}.policy.yaml`;
}

/**
 * The outcome of looking up one local-state entry. Absence and refusal stay
 * apart on purpose: an absent optional file changes nothing, while a link or an
 * unreadable file is a fact the report has to carry.
 */
export type OpenState<T> =
  | { state: "ok"; value: T }
  | { state: "absent" }
  | { state: "refused"; reason: string; code?: "link" | "too_large" | "changed" | "other" };

export type WriteResult = { ok: true } | { ok: false; reason: string };

const DIRECTORY_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const FILE_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

function errorCode(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    return typeof code === "string" ? code : "";
  }
  return "";
}

function childPath(parentFd: number, name: string): string {
  return `${directoryHandlePath(parentFd)}/${name}`;
}

const LINK_REASON = (name: string): string =>
  `${name} is a symbolic link, which is not followed or read.`;

/**
 * Open an existing child directory of a pinned parent. The name is resolved from
 * the handle, so replacing the pathname cannot redirect it. A link or a
 * non-directory at the name is refused. Absence is reported as absence.
 */
export function openChildDirectory(parentFd: number, name: string): OpenState<number> {
  const path = childPath(parentFd, name);
  let listed;
  try {
    listed = lstatSync(path);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { state: "absent" };
    return { state: "refused", code: "other", reason: `${name} could not be checked.` };
  }
  if (listed.isSymbolicLink()) return { state: "refused", code: "link", reason: LINK_REASON(name) };
  if (!listed.isDirectory()) return { state: "refused", code: "other", reason: `${name} is not a directory.` };
  let fd: number | undefined;
  try {
    fd = openSync(path, DIRECTORY_FLAGS);
    const opened = fstatSync(fd);
    // The listed object and the opened object must be the same directory. A
    // swap between lstat and open is caught here and read from neither.
    if (!opened.isDirectory() || opened.dev !== listed.dev || opened.ino !== listed.ino) {
      closeSync(fd);
      return { state: "refused", code: "changed", reason: `${name} changed before it could be opened, so it was not read.` };
    }
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    const code = errorCode(error);
    if (code === "ELOOP" || code === "ENOTDIR") return { state: "refused", code: "link", reason: LINK_REASON(name) };
    return { state: "refused", code: "other", reason: `${name} could not be opened.` };
  }
  return { state: "ok", value: fd };
}

/**
 * Open a child directory, creating it if it is absent. A link or a plain file at
 * the name is refused rather than replaced. The create and the open both resolve
 * from the pinned parent, and the opened directory is checked against the listed
 * one, so a create raced by a link does not win.
 */
export function ensureChildDirectory(parentFd: number, name: string): OpenState<number> {
  const existing = openChildDirectory(parentFd, name);
  if (existing.state !== "absent") return existing;
  try {
    mkdirSync(childPath(parentFd, name));
  } catch (error) {
    // EEXIST is a concurrent create: re-open and let the link check decide. Any
    // other error is a real refusal.
    if (errorCode(error) !== "EEXIST") {
      return { state: "refused", reason: `${name} could not be created.` };
    }
  }
  return openChildDirectory(parentFd, name);
}

/**
 * Read one regular file under a pinned parent, bounded. A link, a non-regular
 * file, an over-bound file, or a file that changes under the read is refused.
 * Absence is reported as absence.
 */
export function readBoundedFile(parentFd: number, name: string, maxBytes: number): OpenState<string> {
  const path = childPath(parentFd, name);
  let fd: number | undefined;
  try {
    fd = openSync(path, FILE_FLAGS);
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT") return { state: "absent" };
    if (code === "ELOOP" || code === "ENOTDIR") return { state: "refused", code: "link", reason: LINK_REASON(name) };
    return { state: "refused", code: "other", reason: `${name} could not be read.` };
  }
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile()) return { state: "refused", code: "other", reason: `${name} is not a regular file.` };
    if (opened.size > maxBytes) {
      return { state: "refused", code: "too_large", reason: `${name} is larger than ${maxBytes} bytes and was not read.` };
    }
    const buffer = Buffer.alloc(opened.size);
    let count = 0;
    while (count < buffer.length) {
      const read = readSync(fd, buffer, count, buffer.length - count, null);
      if (read === 0) break;
      count += read;
    }
    const after = fstatSync(fd);
    if (count !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) {
      return { state: "refused", code: "changed", reason: `${name} changed while it was being read.` };
    }
    const text = buffer.toString("utf8");
    if (text.includes("\u0000")) return { state: "refused", code: "other", reason: `${name} is not text.` };
    return { state: "ok", value: text };
  } catch {
    return { state: "refused", code: "other", reason: `${name} could not be read.` };
  } finally {
    closeSync(fd);
  }
}

/** List the names in an existing child directory of a pinned parent. */
export function listDirectoryNames(parentFd: number, name: string): OpenState<string[]> {
  const opened = openChildDirectory(parentFd, name);
  if (opened.state !== "ok") return opened;
  const fd = opened.value;
  try {
    return { state: "ok", value: readdirSync(directoryHandlePath(fd)) };
  } catch {
    return { state: "refused", code: "other", reason: `The directory ${name} could not be listed.` };
  } finally {
    closeSync(fd);
  }
}

let tempCounter = 0;

/**
 * Write one file under a pinned parent, without ever truncating an existing file
 * or following a link.
 *
 * The bytes go to a fresh temp file in the same directory, opened with
 * `O_EXCL | O_NOFOLLOW`, and that temp name is then renamed over the target. The
 * temp file descriptor is held, and both the target and the temp name are
 * re-checked immediately before the rename:
 *
 *   - The target is checked again for presence, type, and, when it existed
 *     before, the same dev/ino. A link or a non-regular file at the target is
 *     refused. This closes the window where the target is replaced after the
 *     first check.
 *   - The temp name is checked again with `lstat` and must still be the regular
 *     file this function just opened (`fstat` on the held descriptor).
 *
 * What this does NOT claim: `rename` takes a pathname, so there is an
 * unavoidable last instant between the temp-name check and the rename itself.
 * An attacker who can replace the temp name inside that window is not fully
 * excluded by a Node `fs` call alone. The guarantee is bounded: a target that is
 * a link at any check, or that changes identity between the two checks, is
 * refused, and the window is reduced to the single rename call. A verified
 * publish (for example an atomic exchange) is not available in the Node ABI this
 * engine targets, so it is not used and not claimed.
 *
 * A failure returns a short reason and, when the operation created the temp
 * file and captured its identity, removes that temp file if it is still the
 * file this call wrote. A temp file whose identity was never captured (the
 * pre-write checks failed, or `fstatSync` threw after the create) is left in
 * place rather than deleted: without the opened identity, the call cannot
 * prove a replacement did not occur, and it does not remove a name it cannot
 * vouch for. A temp file that this call did not create, or that was replaced
 * by someone else, is left alone for the same reason. Nothing outside the
 * pinned directory is read.
 */
export function writeFileAtomic(parentFd: number, name: string, content: string, createMode = 0o600): WriteResult {
  const dir = directoryHandlePath(parentFd);
  const target = `${dir}/${name}`;
  const existing = lstatQuiet(target);
  if (existing.state === "refused") return { ok: false, reason: `${name} could not be checked.` };
  if (existing.state === "ok") {
    const info = existing.value;
    if (info.isSymbolicLink()) {
      return { ok: false, reason: `${name} is a symbolic link, so nothing was written over it.` };
    }
    if (!info.isFile()) return { ok: false, reason: `${name} is not a regular file.` };
    // A target with no owner-write bit is treated as one the person does not
    // want replaced through this path. The base behaviour refused such a write
    // (open for write fails), so this keeps that refusal rather than clobbering a
    // file the person made read-only.
    if ((info.mode & 0o200) === 0) {
      return { ok: false, reason: `${name} is not writable, so nothing was written over it.` };
    }
  }
  // New private state is created 0o600. An existing file keeps the permissions
  // it already had, so replacing `.gitignore` does not quietly change its mode.
  // The caller sets createMode for a file that is not private state.
  const mode = existing.state === "ok" ? existing.value.mode & 0o777 : createMode;
  tempCounter += 1;
  const temp = `.ls-tmp-${process.pid}-${Date.now().toString(36)}-${tempCounter}`;
  const tempPath = `${dir}/${temp}`;
  let fd: number | undefined;
  let openedIdentity: { dev: number; ino: number } | null = null;
  try {
    fd = openSync(tempPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
    const opened = fstatSync(fd);
    if (!opened.isFile()) return { ok: false, reason: `${name} could not be written as a regular file.` };
    openedIdentity = { dev: opened.dev, ino: opened.ino };
    const buffer = Buffer.from(content, "utf8");
    let written = 0;
    while (written < buffer.length) {
      written += writeSync(fd, buffer, written, buffer.length - written);
    }
    // The temp name must still be the regular file this call opened, and the
    // target must still match what the first check saw, before publishing.
    const tempNow = lstatQuiet(tempPath);
    if (tempNow.state !== "ok" || tempNow.value.isSymbolicLink() || !tempNow.value.isFile()) {
      return { ok: false, reason: `${name} could not be written: the temporary name changed before publishing.` };
    }
    if (tempNow.value.dev !== opened.dev || tempNow.value.ino !== opened.ino) {
      return { ok: false, reason: `${name} could not be written: the temporary name was replaced before publishing.` };
    }
    const targetNow = lstatQuiet(target);
    if (targetNow.state === "refused") return { ok: false, reason: `${name} could not be checked before publishing.` };
    if (existing.state === "ok") {
      if (targetNow.state !== "ok") {
        return { ok: false, reason: `${name} changed before publishing, so nothing was written over it.` };
      }
      if (
        targetNow.value.isSymbolicLink() ||
        !targetNow.value.isFile() ||
        targetNow.value.dev !== existing.value.dev ||
        targetNow.value.ino !== existing.value.ino
      ) {
        return { ok: false, reason: `${name} changed before publishing, so nothing was written over it.` };
      }
    } else if (targetNow.state === "ok") {
      // The target appeared after this call checked it was absent. It is not this
      // call's file, so it is not overwritten.
      return { ok: false, reason: `${name} appeared while it was being written, so nothing was written over it.` };
    }
    closeSync(fd);
    fd = undefined;
    renameSync(tempPath, target);
    return { ok: true };
  } catch {
    return { ok: false, reason: `${name} could not be written.` };
  } finally {
    if (fd !== undefined) closeSync(fd);
    // Only remove the temp file this call created, and only if the name is still
    // that exact regular file (same dev/ino this call opened). A concurrent
    // replacement, or a name this call did not create, is left alone.
    if (openedIdentity !== null) removeOwnTemp(tempPath, openedIdentity);
  }
}

type LstatResult = { state: "ok"; value: Stats } | { state: "absent" } | { state: "refused" };

function lstatQuiet(path: string): LstatResult {
  try {
    return { state: "ok", value: lstatSync(path) };
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { state: "absent" };
    return { state: "refused" };
  }
}

function removeOwnTemp(tempPath: string, identity: { dev: number; ino: number }): void {
  try {
    const info = lstatSync(tempPath);
    if (!info.isFile() || info.isSymbolicLink()) return;
    if (info.dev !== identity.dev || info.ino !== identity.ino) return;
    unlinkSync(tempPath);
  } catch {
    // The temp file is already gone or cannot be removed. Best effort only.
  }
}
