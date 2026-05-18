import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/auth";
import { useI18n } from "@/hooks/i18n";
import { useNotificationsStream, registerToastForSSE } from "@/hooks/use-notifications-stream";
import { useIdleTimeout } from "@/hooks/use-idle-timeout";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  useListNotifications, getListNotificationsQueryKey,
  useGetNurseDashboard, getGetNurseDashboardQueryKey,
  useGetFrontDeskDashboard, getGetFrontDeskDashboardQueryKey,
  useGetBillingDashboard, getGetBillingDashboardQueryKey,
} from "@workspace/api-client-react";
import { LogOut, Globe, Activity, CalendarDays, Moon, Sun, UserPlus, CalendarPlus, Stethoscope } from "lucide-react";
import GlobalSearch from "@/components/GlobalSearch";
import { navItems, navPinnedByRole } from "@/lib/route-access";
import { useEffect, useState } from "react";

function NurseContextLine() {
  const { t } = useI18n();
  const { data } = useGetNurseDashboard({ query: { queryKey: getGetNurseDashboardQueryKey(), staleTime: 30000 } });
  if (!data) return null;
  const waiting = data.vitalsPending?.length ?? 0;
  return <span className="text-xs text-muted-foreground">{waiting} {t("nurseVitalsPending")}</span>;
}

function FrontDeskContextLine() {
  const { t } = useI18n();
  const { data } = useGetFrontDeskDashboard({ query: { queryKey: getGetFrontDeskDashboardQueryKey(), staleTime: 30000 } });
  if (!data) return null;
  return <span className="text-xs text-muted-foreground">{data.totalToday} {t("frontDeskTotalToday").toLowerCase()}</span>;
}

function BillingContextLine() {
  const { t } = useI18n();
  const { data } = useGetBillingDashboard({ query: { queryKey: getGetBillingDashboardQueryKey(), staleTime: 30000 } });
  if (!data) return null;
  return <span className="text-xs text-muted-foreground">{data.pendingCount} {t("billingPendingInvoices").toLowerCase()}</span>;
}

function RoleContextLine({ role }: { role: string }) {
  if (role === "nurse")           return <NurseContextLine />;
  if (role === "front_desk")      return <FrontDeskContextLine />;
  if (role === "billing_manager") return <BillingContextLine />;
  return null;
}

function RoleQuickActions({ role }: { role: string }) {
  const { t } = useI18n();
  const [, setLocation] = useLocation();

  if (role === "nurse") {
    return (
      <Button size="sm" variant="outline" className="h-6 text-[11px] px-2 gap-1" onClick={() => setLocation("/triage")}>
        <Stethoscope className="w-3 h-3" />
        {t("triage")}
      </Button>
    );
  }
  if (role === "front_desk") {
    return (
      <div className="flex items-center gap-1.5">
        <Button size="sm" variant="outline" className="h-6 text-[11px] px-2 gap-1" onClick={() => setLocation("/appointments?new=1")}>
          <CalendarPlus className="w-3 h-3" />
          {t("newAppointment")}
        </Button>
        <Button size="sm" variant="outline" className="h-6 text-[11px] px-2 gap-1" onClick={() => setLocation("/patients?new=1")}>
          <UserPlus className="w-3 h-3" />
          {t("newPatient")}
        </Button>
      </div>
    );
  }
  if (role === "billing_manager") {
    return (
      <Button size="sm" variant="outline" className="h-6 text-[11px] px-2 gap-1" onClick={() => setLocation("/billing")}>
        <Activity className="w-3 h-3" />
        {t("billing")}
      </Button>
    );
  }
  return null;
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const { t, language, setLanguage, isRtl } = useI18n();
  const [location] = useLocation();
  const { toast } = useToast();

  const [isDark, setIsDark] = useState(() => {
    if (typeof window === "undefined") return false;
    return document.documentElement.classList.contains("dark") || 
      localStorage.getItem("theme") === "dark";
  });

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      root.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  }, [isDark]);

  useNotificationsStream();
  registerToastForSSE(({ title, description }) => toast({ title, description }));
  useIdleTimeout(logout, !!user);

  const { data: notifications } = useListNotifications(
    { unreadOnly: true },
    { query: { queryKey: getListNotificationsQueryKey({ unreadOnly: true }) } }
  );
  const unreadCount = notifications?.length ?? 0;

  const visibleItems = (() => {
    const filtered = navItems.filter(item => {
      if (!item.roles) return true;
      return user && item.roles.includes(user.role);
    });
    if (!user) return filtered;
    const pinned = navPinnedByRole[user.role] ?? [];
    if (!pinned.length) return filtered;
    const pinnedItems = pinned
      .map(key => filtered.find(i => i.key === key))
      .filter(Boolean) as typeof filtered;
    const rest = filtered.filter(i => !pinned.includes(i.key));
    return [...rest.slice(0, 1), ...pinnedItems, ...rest.slice(1)];
  })();

  const isActive = (href: string) => {
    if (href === "/dashboard") return location === "/" || location === "/dashboard";
    return location.startsWith(href);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background" dir={isRtl ? "rtl" : "ltr"}>
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 flex flex-col bg-sidebar border-e border-sidebar-border overflow-y-auto scrollbar-thin">
        {/* Logo */}
        <div className="px-4 py-4 border-b border-sidebar-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded bg-sidebar-primary flex items-center justify-center">
              <Activity className="w-4 h-4 text-sidebar-primary-foreground" />
            </div>
            <div>
              <div className="text-xs font-bold text-sidebar-foreground leading-tight">MediCore</div>
              <div className="text-[10px] text-sidebar-foreground/50 leading-tight">Clinic System</div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {visibleItems.map(item => (
            <Link key={item.key} href={item.href}>
              <div
                className={cn(
                  "flex items-center gap-2.5 px-2.5 py-1.5 rounded text-xs font-medium cursor-pointer transition-colors",
                  isActive(item.href)
                    ? "bg-sidebar-primary text-sidebar-primary-foreground border-s-2 border-sidebar-primary-foreground/40 shadow-sm"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                )}
                data-testid={`nav-${item.key}`}
              >
                <item.icon className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="flex-1">{t(item.labelKey as any)}</span>
                {item.key === "notifications" && unreadCount > 0 && (
                  <Badge className="h-4 min-w-4 text-[10px] px-1 bg-destructive text-destructive-foreground border-none">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </Badge>
                )}
              </div>
            </Link>
          ))}
        </nav>

        {/* User + Actions */}
        <div className="p-2 border-t border-sidebar-border flex-shrink-0 space-y-1">
          <GlobalSearch />
          <button
            onClick={() => setLanguage(language === "en" ? "ar" : "en")}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-xs text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
            data-testid="button-toggle-language"
          >
            <Globe className="w-3.5 h-3.5" />
            <span>{language === "en" ? "العربية" : "English"}</span>
          </button>
          <button
            onClick={() => setIsDark(!isDark)}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-xs text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
            data-testid="button-toggle-theme"
          >
            {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            <span>{isDark ? t("light_mode") || "Light Mode" : t("dark_mode") || "Dark Mode"}</span>
          </button>
          {user && (
            <div className="px-2.5 py-1.5">
              <div className="text-[11px] font-semibold text-sidebar-foreground truncate">{user.fullName}</div>
              <div className="text-[10px] text-sidebar-foreground/50 capitalize">{t(user.role as any)}</div>
            </div>
          )}
          <button
            onClick={logout}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-xs text-destructive/80 hover:text-destructive hover:bg-destructive/10 transition-colors"
            data-testid="button-logout"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>{t("logout")}</span>
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        {user && (
          <div className="h-10 px-4 flex items-center justify-between border-b border-border bg-background/80 backdrop-blur-sm flex-shrink-0">
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">
                {t("welcome")}, <span className="font-medium text-foreground">{user.fullName}</span>
              </span>
              <RoleContextLine role={user.role} />
              <RoleQuickActions role={user.role} />
            </div>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarDays className="w-3.5 h-3.5" />
              {new Date().toLocaleDateString(language === "ar" ? "ar-EG" : "en-US", { weekday: "short", year: "numeric", month: "short", day: "numeric" })}
            </span>
          </div>
        )}
        <main className="flex-1 overflow-y-auto scrollbar-thin">
          {children}
        </main>
      </div>
    </div>
  );
}
