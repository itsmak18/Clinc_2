import { useEffect, useRef, useCallback, useState } from "react";

const IDLE_TIMEOUT_MS   = 28 * 60 * 1000; // 28 min → show warning
const LOGOUT_TIMEOUT_MS = 30 * 60 * 1000; // 30 min → auto-logout

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "click"] as const;

interface UseSessionTimeoutOptions {
  enabled: boolean;
  onLogout: () => void;
}

export function useSessionTimeout({ enabled, onLogout }: UseSessionTimeoutOptions) {
  const [showWarning, setShowWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(120);
  const idleTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
    }, 2 * 60 * 1000);
  }, [onLogout]);

  const resetTimer = useCallback(() => {
    if (!enabled) return;
    clearAllTimers();
    setShowWarning(false);
    idleTimer.current = setTimeout(startLogoutCountdown, IDLE_TIMEOUT_MS);
  }, [enabled, clearAllTimers, startLogoutCountdown]);

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
