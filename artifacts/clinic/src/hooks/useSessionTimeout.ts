import { useEffect, useRef, useCallback, useState } from "react";

// Defaults — used only when we can't read the JWT exp from /api/auth/me.
const DEFAULT_IDLE_TIMEOUT_MS   = 28 * 60 * 1000;
const DEFAULT_LOGOUT_TIMEOUT_MS = 30 * 60 * 1000;

const WARNING_LEAD_MS = 2 * 60 * 1000;

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "click"] as const;

interface UseSessionTimeoutOptions {
  enabled: boolean;
  onLogout: () => void;
  /**
   * Optional JWT exp (unix seconds). When provided, the warning fires
   * 2 min before this timestamp and auto-logout fires at this timestamp,
   * so the idle warning matches the actual server-side TTL per role
   * (super_admin: 15 min, admin: 1h, etc.). When omitted, fall back to
   * the 28/30 min defaults.
   */
  jwtExpUnix?: number;
}

export function useSessionTimeout({ enabled, onLogout, jwtExpUnix }: UseSessionTimeoutOptions) {
  const [showWarning, setShowWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(120);
  const idleTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Resolve the effective idle/logout durations from the JWT exp claim, with
  // a sane floor (the 401 interceptor will catch us anyway if these drift).
  const { idleMs, logoutMs } = (() => {
    if (!jwtExpUnix) {
      return { idleMs: DEFAULT_IDLE_TIMEOUT_MS, logoutMs: DEFAULT_LOGOUT_TIMEOUT_MS };
    }
    const remainingMs = jwtExpUnix * 1000 - Date.now();
    if (remainingMs < 60_000) {
      // Token already very close to expiring — fall back to defaults to avoid
      // negative timers; the 401 interceptor will fire imminently regardless.
      return { idleMs: DEFAULT_IDLE_TIMEOUT_MS, logoutMs: DEFAULT_LOGOUT_TIMEOUT_MS };
    }
    return {
      idleMs:   Math.max(60_000, remainingMs - WARNING_LEAD_MS),
      logoutMs: remainingMs,
    };
  })();

  const clearAllTimers = useCallback(() => {
    if (idleTimer.current)   clearTimeout(idleTimer.current);
    if (logoutTimer.current) clearTimeout(logoutTimer.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
  }, []);

  const startLogoutCountdown = useCallback(() => {
    setShowWarning(true);
    setSecondsLeft(120);
    countdownRef.current = setInterval(() => {
      setSecondsLeft(s => {
        if (s <= 1) {
          clearInterval(countdownRef.current!);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    logoutTimer.current = setTimeout(() => {
      setShowWarning(false);
      onLogout();
    }, WARNING_LEAD_MS);
  }, [onLogout]);

  const resetTimer = useCallback(() => {
    if (!enabled) return;
    clearAllTimers();
    setShowWarning(false);
    idleTimer.current = setTimeout(startLogoutCountdown, idleMs);
  }, [enabled, clearAllTimers, startLogoutCountdown, idleMs]);

  const stayLoggedIn = useCallback(() => {
    resetTimer();
  }, [resetTimer]);

  useEffect(() => {
    if (!enabled) return;
    resetTimer();
    const handler = () => { if (!showWarning) resetTimer(); };
    ACTIVITY_EVENTS.forEach(ev => window.addEventListener(ev, handler, { passive: true }));
    return () => {
      clearAllTimers();
      ACTIVITY_EVENTS.forEach(ev => window.removeEventListener(ev, handler));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { showWarning, secondsLeft, stayLoggedIn };
}
