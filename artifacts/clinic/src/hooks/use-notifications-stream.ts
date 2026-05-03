import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getListNotificationsQueryKey } from "@workspace/api-client-react";

const BASE = import.meta.env.BASE_URL ?? "/";

export function useNotificationsStream() {
  const queryClient = useQueryClient();
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("clinic_token");
    if (!token) return;

    function connect() {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }

      const url = `${BASE}api/notifications/stream`.replace(/\/+/g, "/");
      const es = new EventSource(`${url}?token=${encodeURIComponent(token!)}`, { withCredentials: false });
      esRef.current = es;

      es.addEventListener("notification", () => {
        queryClient.invalidateQueries({
          queryKey: getListNotificationsQueryKey({ unreadOnly: true }),
        });
        queryClient.invalidateQueries({
          queryKey: getListNotificationsQueryKey({}),
        });
      });

      es.onerror = () => {
        es.close();
        esRef.current = null;
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
