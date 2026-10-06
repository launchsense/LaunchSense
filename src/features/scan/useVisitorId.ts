import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";

// One anonymous id per browser, so visits can be counted as distinct without
// naming a person, a device, or an address. The server mints it, the browser
// keeps it in local storage, and a stored value that is not the minted shape
// is thrown away and re-minted. Private mode has no storage, so that visit
// simply counts without an id: events still log, the journey join skips them.
const STORAGE_KEY = "launchsense_visitor";
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function useVisitorId(): string | undefined {
  const ensureVisitor = useMutation(api.scans.queries.ensureVisitor);
  const [visitorId, setVisitorId] = useState<string | undefined>(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      return stored !== null && UUID_SHAPE.test(stored) ? stored.toLowerCase() : undefined;
    } catch {
      return undefined;
    }
  });
  useEffect(() => {
    if (visitorId !== undefined) return;
    let live = true;
    void ensureVisitor({}).then((result) => {
      if (!live || result === null) return;
      try {
        window.localStorage.setItem(STORAGE_KEY, result.visitorId);
      } catch {
        return;
      }
      setVisitorId(result.visitorId);
    });
    return () => {
      live = false;
    };
  }, [visitorId, ensureVisitor]);
  return visitorId;
}
