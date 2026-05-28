import { toast as sonnerToast } from "sonner";

type Kind = "success" | "warn" | "danger" | "default";

interface SimpleToastOptions {
  kind?: Kind;
  /** Optional undo/action button — extends TTL to 6 000 ms when present. */
  action?: { label: string; onClick: () => void };
  duration?: number;
}

/** Thin wrapper around Sonner that mirrors the Bayan toast API.
 *  Uses the semantic Bayan CSS vars applied to the Sonner Toaster in App.tsx. */
export function useSimpleToast() {
  const show = (message: string, opts: SimpleToastOptions = {}) => {
    const { kind = "default", action, duration } = opts;
    const ttl = duration ?? (action ? 6000 : 4000);

    const sonnerOpts = {
      duration: ttl,
      action: action
        ? { label: action.label, onClick: action.onClick }
        : undefined,
    };

    if (kind === "success") sonnerToast.success(message, sonnerOpts);
    else if (kind === "danger") sonnerToast.error(message, sonnerOpts);
    else if (kind === "warn")   sonnerToast.warning(message, sonnerOpts);
    else                        sonnerToast(message, sonnerOpts);
  };

  return { show };
}
