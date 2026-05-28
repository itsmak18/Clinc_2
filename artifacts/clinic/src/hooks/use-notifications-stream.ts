import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getListNotificationsQueryKey } from "@workspace/api-client-react";

const BASE = import.meta.env.BASE_URL ?? "/";

type ToastFn = (opts: { title: string; description?: string }) => void;

let _toastFn: ToastFn | null = null;

export function registerToastForSSE(fn: ToastFn) {
  _toastFn = fn;
}

export function useNotificationsStream() {
  const queryClient = useQueryClient();
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function connect() {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }

      const url = `${BASE}api/notifications/stream`.replace(/\/+/g, "/");
      const es = new EventSource(url, { withCredentials: true });
      esRef.current = es;

      es.addEventListener("notification", (e: MessageEvent) => {
        queryClient.invalidateQueries({
          queryKey: getListNotificationsQueryKey({ unreadOnly: true }),
        });
        queryClient.invalidateQueries({
          queryKey: getListNotificationsQueryKey({}),
        });
        try {
          const notif = JSON.parse(e.data);
          if (_toastFn) {
            _toastFn({ title: notif.title, description: notif.message });
          }
        } catch {
          // ignore parse errors
        }
      });

      // Server sends this during graceful shutdown with a per-connection jitter
      // delay (5–15s) so clients spread their reconnects rather than all hitting
      // the new pod at once. Use the server-supplied retryAfter when present.
      es.addEventListener("reconnect", (e: MessageEvent) => {
        es.close();
        esRef.current = null;
        let delay = 5000;
        try {
          const d = JSON.parse(e.data) as { retryAfter?: number };
          if (typeof d.retryAfter === "number" && d.retryAfter > 0) {
            delay = d.retryAfter;
          }
        } catch {
          // use default delay
        }
        reconnectTimer.current = setTimeout(connect, delay);
      });

      es.onerror = () => {
        es.close();
        esRef.current = null;
        // Fixed 5s backoff for network errors (not server-initiated drain).
        reconnectTimer.current = setTimeout(connect, 5000);
      };
    }

    connect();

    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
    };
  }, [queryClient]);
}
