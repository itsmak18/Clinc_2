import { useCallback, useRef, useState } from "react";

/** Holds data-pending="true" on a button for at least `minMs` (default 450ms)
 *  to avoid flashing spinners on fast mutations. */
export function usePendingId(minMs = 450) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const start = useCallback((id: string) => {
    setPendingId(id);
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const stop = useCallback(() => {
    timer.current = setTimeout(() => {
      setPendingId(null);
    }, minMs);
  }, [minMs]);

  const isPending = useCallback((id: string) => pendingId === id, [pendingId]);

  return { start, stop, isPending, pendingId };
}
