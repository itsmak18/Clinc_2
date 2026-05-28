import { useEffect, useState, useCallback } from "react";

/** Two-way sync between a state value and a URL hash search param.
 *  e.g. useUrlSync("p") reads/writes the `?p=<value>` portion of the hash. */
export function useUrlSync(paramName: string): [string | null, (val: string | null) => void] {
  const readFromHash = (): string | null => {
    if (typeof window === "undefined") return null;
    const hash = window.location.hash; // e.g. "#/consult?p=12"
    const qIdx = hash.indexOf("?");
    if (qIdx === -1) return null;
    const search = new URLSearchParams(hash.slice(qIdx + 1));
    return search.get(paramName);
  };

  const [value, setValue] = useState<string | null>(readFromHash);

  useEffect(() => {
    const handler = () => setValue(readFromHash());
    window.addEventListener("hashchange", handler);
    window.addEventListener("popstate", handler);
    return () => {
      window.removeEventListener("hashchange", handler);
      window.removeEventListener("popstate", handler);
    };
  });

  const setValueAndHash = useCallback((val: string | null) => {
    setValue(val);
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    const qIdx = hash.indexOf("?");
    const route = qIdx === -1 ? hash : hash.slice(0, qIdx);
    if (val == null) {
      window.history.replaceState(null, "", route || "#/");
    } else {
      const params = new URLSearchParams();
      params.set(paramName, val);
      window.history.replaceState(null, "", `${route}?${params.toString()}`);
    }
  }, [paramName]);

  return [value, setValueAndHash];
}

/** Read the current patient id from the URL hash (?p=<id>) */
export function useCurrentPatientId(): [number | null, (id: number | null) => void] {
  const [raw, setRaw] = useUrlSync("p");
  const id = raw != null ? parseInt(raw, 10) : null;
  const setId = useCallback((v: number | null) => setRaw(v != null ? String(v) : null), [setRaw]);
  return [Number.isNaN(id) ? null : id, setId];
}
