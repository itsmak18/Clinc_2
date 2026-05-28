import { useEffect, useState } from "react";

const STORAGE_PREFIX = "clinic.loaded.";

/** Shows a loading skeleton for `durationMs` on the first mount per session
 *  for a given screen key. Subsequent mounts within the same session skip it. */
export function useFirstMountLoading(screenKey: string, durationMs = 700): boolean {
  const storageKey = STORAGE_PREFIX + screenKey;
  const alreadyLoaded = typeof sessionStorage !== "undefined"
    ? !!sessionStorage.getItem(storageKey)
    : true;

  const [loading, setLoading] = useState(!alreadyLoaded);

  useEffect(() => {
    if (alreadyLoaded) return;
    const t = setTimeout(() => {
      sessionStorage.setItem(storageKey, "1");
      setLoading(false);
    }, durationMs);
    return () => clearTimeout(t);
  }, [storageKey, alreadyLoaded, durationMs]);

  return loading;
}
