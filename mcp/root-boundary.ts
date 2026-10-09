import { closeSync, constants, fstatSync, lstatSync, openSync } from "node:fs";
import { dirname, isAbsolute, join, parse, sep } from "node:path";

/** A directory handle is pinned even if its path is renamed or replaced. */
export function directoryHandlePath(fd: number): string {
  if (process.platform === "linux") return `/proc/self/fd/${fd}`;
  if (process.platform === "darwin") return `/dev/fd/${fd}`;
  throw new Error("Secure local directory reads are not available on this platform.");
}

export function openReviewRoot(requested: string): { root: string; fd: number } {
  const absolute = isAbsolute(requested) ? requested : `${process.cwd()}${sep}${requested}`;
  let root = parse(absolute).root;
  let fd = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    // Check raw components before normalising '..'. Every child is opened from
    // its pinned parent, never through a pathname an attacker can redirect.
    for (const component of absolute.slice(root.length).split(sep)) {
      if (component === "" || component === ".") continue;
      const path = `${directoryHandlePath(fd)}/${component}`;
      const listed = lstatSync(path);
      if (listed.isSymbolicLink() || !listed.isDirectory()) {
        throw new Error("Symbolic link or non-directory in review root. Not followed or read. Select the real directory.");
      }
      let child: number;
      try {
        child = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      } catch {
        throw new Error("Symbolic link or changed entry in review root. Not followed or read. Select the real directory.");
      }
      const opened = fstatSync(child);
      if (opened.dev !== listed.dev || opened.ino !== listed.ino) {
        closeSync(child);
        throw new Error("The review root changed before it could be read. Nothing was followed or read.");
      }
      closeSync(fd);
      fd = child;
      root = component === ".." ? dirname(root) : join(root, component);
    }
    return { root, fd };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}
