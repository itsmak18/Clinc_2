import { createContext, useContext, useState, useCallback, useRef, ReactNode } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/hooks/i18n";
import type { PrintLang } from "@/lib/print";

// Lets any print action ask the user which language to produce the paper in,
// independent of the current UI language. `choosePrintLanguage()` resolves with
// "en" | "ar", or null if the user dismisses the dialog.
interface PrintLangContextType {
  choosePrintLanguage: () => Promise<PrintLang | null>;
}

const PrintLangContext = createContext<PrintLangContextType | null>(null);

export function PrintLangProvider({ children }: { children: ReactNode }) {
  const { t, language } = useI18n();
  const [open, setOpen] = useState(false);
  const resolverRef = useRef<((v: PrintLang | null) => void) | null>(null);

  const choosePrintLanguage = useCallback(
    () =>
      new Promise<PrintLang | null>(resolve => {
        resolverRef.current = resolve;
        setOpen(true);
      }),
    [],
  );

  const settle = (lang: PrintLang | null) => {
    setOpen(false);
    resolverRef.current?.(lang);
    resolverRef.current = null;
  };

  return (
    <PrintLangContext.Provider value={{ choosePrintLanguage }}>
      {children}
      <Dialog open={open} onOpenChange={o => { if (!o) settle(null); }}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>{t("printLanguage")}</DialogTitle>
          </DialogHeader>
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              className={`btn flex-1 ${language === "en" ? "btn-primary" : "btn-outline"}`}
              onClick={() => settle("en")}
              data-testid="print-lang-en"
            >
              English
            </button>
            <button
              type="button"
              className={`btn flex-1 ${language === "ar" ? "btn-primary" : "btn-outline"}`}
              onClick={() => settle("ar")}
              data-testid="print-lang-ar"
            >
              العربية
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </PrintLangContext.Provider>
  );
}

export function usePrintLang() {
  const ctx = useContext(PrintLangContext);
  if (!ctx) throw new Error("usePrintLang must be used within PrintLangProvider");
  return ctx.choosePrintLanguage;
}
