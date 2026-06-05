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
  const attemptRef = useRef(0);
  const lastEventIdRef = useRef<number | null>(null);

  useEffect(() => {
    function connect() {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }

      let url = `${BASE}api/notifications/stream`.replace(/\/+/g, "/");
      // Send Last-Event-ID as a query param since EventSource doesn't let us
      // set custom headers. The server reads it from the Last-Event-ID header
      // (browsers set it automatically on reconnect when the stream uses id: fields)
      // and falls back to the query param for programmatic reconnects.
      if (lastEventIdRef.current !== null) {
        url += `?lastEventId=${lastEventIdRef.current}`;
      }

      const es = new EventSource(url, { withCredentials: true });
      esRef.current = es;

      es.addEventListener("connected", () => {
        // Reset backoff on a successful connection.
        attemptRef.current = 0;
      });

      es.addEventListener("notification", (e: MessageEvent) => {
        // Track the last seen event ID for replay on reconnect.
        if ((e as any).lastEventId) {
          const parsed = parseInt((e as any).lastEventId, 10);
          if (!isNaN(parsed)) lastEventIdRef.current = parsed;
        }

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
        // Server-initiated drain: don't increment the backoff counter.
        reconnectTimer.current = setTimeout(connect, delay);
      });

      es.onerror = () => {
        es.close();
        esRef.current = null;
        // Exponential backoff with ±20% jitter for network errors.
        // Caps at 30 s so a prolonged outage doesn't freeze notifications.
        const attempt = attemptRef.current;
        attemptRef.current = attempt + 1;
        const base = Math.min(1000 * Math.pow(2, attempt), 30_000);
        const jitter = base * 0.2 * (Math.random() * 2 - 1); // ±20%
        const delay = Math.round(base + jitter);
        reconnectTimer.current = setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
    };
  }, [queryClient]);
}
