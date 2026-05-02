import { createContext, useContext, useState, useEffect } from "react";

type Language = "en" | "ar";

interface I18nContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const translations: Record<Language, Record<string, string>> = {
  en: {
    "app.name": "Clinic Management System",
    "nav.dashboard": "Dashboard",
    "nav.patients": "Patients",
    "nav.appointments": "Appointments",
    "nav.medical_records": "Medical Records",
    "nav.prescriptions": "Prescriptions",
    "nav.xray": "X-Ray",
    "nav.lab": "Laboratory",
    "nav.billing": "Billing",
    "nav.operations": "Operations",
    "nav.inventory": "Inventory",
    "nav.reports": "Reports",
    "nav.notifications": "Notifications",
    "nav.users": "Users",
    "nav.audit": "Audit Logs",
    "nav.settings": "Settings",
    "auth.login": "Login",
    "auth.username": "Username",
    "auth.password": "Password",
    "auth.logout": "Logout",
  },
  ar: {
    "app.name": "نظام إدارة العيادة",
    "nav.dashboard": "لوحة القيادة",
    "nav.patients": "المرضى",
    "nav.appointments": "المواعيد",
    "nav.medical_records": "السجلات الطبية",
    "nav.prescriptions": "الوصفات الطبية",
    "nav.xray": "الأشعة",
    "nav.lab": "المختبر",
    "nav.billing": "الفواتير",
    "nav.operations": "العمليات",
    "nav.inventory": "المخزون",
    "nav.reports": "التقارير",
    "nav.notifications": "الإشعارات",
    "nav.users": "المستخدمين",
    "nav.audit": "سجلات التدقيق",
    "nav.settings": "الإعدادات",
    "auth.login": "تسجيل الدخول",
    "auth.username": "اسم المستخدم",
    "auth.password": "كلمة المرور",
    "auth.logout": "تسجيل الخروج",
  }
};

const I18nContext = createContext<I18nContextType | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => {
    const saved = localStorage.getItem("app_lang");
    return (saved === "en" || saved === "ar") ? saved : "en";
  });

  useEffect(() => {
    localStorage.setItem("app_lang", language);
    document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
    document.documentElement.lang = language;
  }, [language]);

  const t = (key: string) => {
    return translations[language][key] || key;
  };

  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used within I18nProvider");
  return context;
}
