import { useEffect, useRef, useCallback } from "react";

const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export function useIdleTimeout(onTimeout: () => void, enabled = true) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(onTimeout, IDLE_TIMEOUT_MS);
  }, [onTimeout]);

  useEffect(() => {
    if (!enabled) return;

    const events = ["mousedown", "mousemove", "keydown", "scroll", "touchstart", "click"];

    const handleActivity = () => reset();

    events.forEach(e => window.addEventListener(e, handleActivity, { passive: true }));
    reset();

    return () => {
      events.forEach(e => window.removeEventListener(e, handleActivity));
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [reset, enabled]);
}
