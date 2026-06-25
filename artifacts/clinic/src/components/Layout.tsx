import { useEffect, useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/auth";
import { useI18n } from "@/hooks/i18n";
import { useNotificationsStream, registerToastForSSE } from "@/hooks/use-notifications-stream";
import { useIdleTimeout } from "@/hooks/use-idle-timeout";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  useListNotifications, getListNotificationsQueryKey,
  useGetNurseDashboard, getGetNurseDashboardQueryKey,
  useGetFrontDeskDashboard, getGetFrontDeskDashboardQueryKey,
  useGetBillingDashboard, getGetBillingDashboardQueryKey,
} from "@workspace/api-client-react";
import { LogOut, Globe, Activity, Moon, Sun, Bell, Search, Link2 } from "lucide-react";
import { navItems, navPinnedByRole, type NavItem } from "@/lib/route-access";
import CommandPalette from "@/components/CommandPalette";
import TweaksPanel from "@/components/TweaksPanel";

// Super-admin / admin see nav grouped into sections; other roles see a flat list
const ADMIN_SECTIONS: { title: string; keys: string[] }[] = [
  { title: "Overview",    keys: ["dashboard"] },
  { title: "Clinical",    keys: ["patients", "appointments", "schedule", "triage", "medical-records"] },
  { title: "Diagnostics", keys: ["prescriptions", "xray", "ultrasound", "lab"] },
  { title: "Operations",  keys: ["billing", "reconciliation", "service-prices", "operations", "inventory", "reports"] },
  { title: "System",      keys: ["users", "audit", "settings", "notifications"] },
];

function initials(name: string): string {
  return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

// ── Role context lines shown under user name in sidebar ──────────────────────

function NurseContextLine() {
  const { data } = useGetNurseDashboard({
    query: { queryKey: getGetNurseDashboardQueryKey(), staleTime: 30_000 },
  });
  const n = data?.vitalsPending?.length ?? 0;
  if (!n) return null;
  return <span className="text-[10px] text-[var(--rose-500)] font-medium">{n} pending</span>;
}

function FrontDeskContextLine() {
  const { data } = useGetFrontDeskDashboard({
    query: { queryKey: getGetFrontDeskDashboardQueryKey(), staleTime: 30_000 },
  });
  if (!data) return null;
  return <span className="text-[10px] text-[var(--ink-muted)]">{data.totalToday} today</span>;
}

function BillingContextLine() {
  const { data } = useGetBillingDashboard({
    query: { queryKey: getGetBillingDashboardQueryKey(), staleTime: 30_000 },
  });
  if (!data) return null;
  return <span className="text-[10px] text-[var(--ink-muted)]">{data.pendingCount} pending</span>;
}

function RoleContextLine({ role }: { role: string }) {
  if (role === "nurse")           return <NurseContextLine />;
  if (role === "front_desk")      return <FrontDeskContextLine />;
  if (role === "billing_manager") return <BillingContextLine />;
  return null;
}

// ── Live clock ───────────────────────────────────────────────────────────────

function LiveClock({ language }: { language: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const locale = language === "ar" ? "ar-EG" : "en-US";
  return (
    <div className="text-end hidden lg:block flex-shrink-0">
      <div className="mono text-[12px] font-semibold text-[var(--ink)] tabular-nums leading-tight">
        {now.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
      </div>
      <div className="text-[10px] text-[var(--ink-muted)] leading-tight">
        {now.toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" })}
      </div>
    </div>
  );
}

// ── Single nav link (used for both flat + grouped rendering) ─────────────────

function NavLink({ item, active, unreadCount = 0 }: { item: NavItem; active: boolean; unreadCount?: number }) {
  const { t } = useI18n();
  return (
    <Link href={item.href}>
      <div
        className={cn("nav-item", active && "is-active")}
        data-testid={`nav-${item.key}`}
        aria-current={active ? "page" : undefined}
      >
        <item.icon className="w-4 h-4 flex-shrink-0" />
        <span className="flex-1 truncate">{t(item.labelKey as any)}</span>
        {unreadCount > 0 && (
          <span
            className="badge badge-rose flex-shrink-0"
            style={{ fontSize: "9px", height: 16, minWidth: 16, padding: "0 3px" }}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </div>
    </Link>
  );
}

// ── Layout ───────────────────────────────────────────────────────────────────

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const { t, language, setLanguage, isRtl } = useI18n();
  const [location] = useLocation();
  const { toast } = useToast();
  const [cmdOpen, setCmdOpen] = useState(false);

  const [isDark, setIsDark] = useState(() => {
    if (typeof window === "undefined") return false;
    return (
      document.documentElement.classList.contains("dark") ||
      localStorage.getItem("theme") === "dark"
    );
  });

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add("dark");
      root.setAttribute("data-theme", "dark");
      localStorage.setItem("theme", "dark");
    } else {
      root.classList.remove("dark");
      root.removeAttribute("data-theme");
      localStorage.setItem("theme", "light");
    }
  }, [isDark]);

  // ⌘K / Ctrl+K keyboard shortcut — skip when input/textarea is focused
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== "k") return;
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) return;
      e.preventDefault();
      setCmdOpen(true);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useNotificationsStream();
  registerToastForSSE(({ title, description }) => toast({ title, description }));
  useIdleTimeout(logout, !!user);

  const { data: notifications } = useListNotifications(
    { unreadOnly: true },
    { query: { queryKey: getListNotificationsQueryKey({ unreadOnly: true }) } }
  );
  const unreadCount = notifications?.length ?? 0;

  // Build the visible nav list, applying the pinned-first ordering for role-specific views
  const visibleItems = useMemo<NavItem[]>(() => {
    const filtered = navItems.filter(
      item => !item.roles || (user && item.roles.includes(user.role))
    );
    if (!user) return filtered;
    const pinned = navPinnedByRole[user.role] ?? [];
    if (!pinned.length) return filtered;
    const pinnedItems = pinned
      .map(key => filtered.find(i => i.key === key))
      .filter(Boolean) as NavItem[];
    const rest = filtered.filter(i => !pinned.includes(i.key));
    return [...rest.slice(0, 1), ...pinnedItems, ...rest.slice(1)];
  }, [user]);

  const isActive = (href: string) => {
    if (href === "/dashboard") return location === "/" || location === "/dashboard";
    return location.startsWith(href);
  };

  // Current page nav item — drives topbar title
  const currentNav = navItems.find(item => isActive(item.href));

  // Admin + super_admin get grouped nav sections; everyone else gets the flat list
  const useGrouped = user?.role === "super_admin" || user?.role === "admin";

  return (
    <div className="app-root" dir={isRtl ? "rtl" : "ltr"}>

      {/* ══ Sidebar ═══════════════════════════════════════════════════════════ */}
      <aside className="sidebar">

        {/* Brand header */}
        <div
          className="flex items-center gap-2.5 flex-shrink-0 px-4 border-b border-[var(--line)]"
          style={{ height: "var(--topbar-h)" }}
        >
          {/* Dark-mode: the blue mark loses contrast on the near-black sidebar,
              so sit it on a light chip (matches the Login art panel). Light mode
              keeps the bare transparent mark. */}
          <div className="flex items-center justify-center w-8 h-8 flex-shrink-0 rounded-md dark:bg-white dark:p-1">
            <img
              src="/wateen-mark.png"
              alt="Wateen Clinic"
              className="w-full h-full object-contain"
              aria-hidden="true"
            />
          </div>
          <div>
            <div className="text-[13px] font-bold text-[var(--ink)] leading-tight">Wateen</div>
            <div className="eyebrow text-[9px] text-[var(--ink-muted)] leading-tight tracking-widest">
              CLINIC
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label={t("mainNavigation")}>
          {useGrouped ? (
            ADMIN_SECTIONS.map(section => {
              const sectionItems = section.keys
                .map(key => visibleItems.find(i => i.key === key))
                .filter(Boolean) as NavItem[];
              if (!sectionItems.length) return null;
              return (
                <div key={section.title} className="mb-1">
                  <div className="nav-section-title">{section.title}</div>
                  {sectionItems.map(item => (
                    <NavLink
                      key={item.key}
                      item={item}
                      active={isActive(item.href)}
                      unreadCount={item.key === "notifications" ? unreadCount : 0}
                    />
                  ))}
                </div>
              );
            })
          ) : (
            visibleItems.map(item => (
              <NavLink
                key={item.key}
                item={item}
                active={isActive(item.href)}
                unreadCount={item.key === "notifications" ? unreadCount : 0}
              />
            ))
          )}
        </nav>

        {/* Sidebar footer: user pill + icon controls */}
        <div className="border-t border-[var(--line)] p-3 flex-shrink-0">
          {user && (
            <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-[var(--surface-2)] transition-colors mb-2 cursor-default">
              <span className="avatar avatar-sm avatar-teal flex-shrink-0">
                {initials(user.fullName)}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold text-[var(--ink)] truncate leading-tight">
                  {user.fullName}
                </div>
                <div className="flex items-center gap-1.5 leading-tight">
                  <span className="text-[10px] text-[var(--ink-muted)] capitalize">
                    {t(user.role as any)}
                  </span>
                  <RoleContextLine role={user.role} />
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center gap-0.5 px-1">
            <TweaksPanel />
            <div className="flex-1" />
            <button
              onClick={() => setLanguage(language === "en" ? "ar" : "en")}
              className="p-1.5 rounded-lg hover:bg-[var(--surface-2)] text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors"
              aria-label={language === "en" ? t("switchToArabic") : t("switchToEnglish")}
              data-testid="button-toggle-language"
            >
              <Globe className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setIsDark(d => !d)}
              className="p-1.5 rounded-lg hover:bg-[var(--surface-2)] text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors"
              aria-label={isDark ? t("light_mode") || "Light mode" : t("dark_mode") || "Dark mode"}
              data-testid="button-toggle-theme"
            >
              {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={logout}
              className="p-1.5 rounded-lg hover:bg-[var(--surface-2)] text-[var(--ink-muted)] hover:text-rose-600 transition-colors"
              aria-label={t("logout")}
              data-testid="button-logout"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* ══ Main area ═════════════════════════════════════════════════════════ */}
      <div className="main">

        {/* Topbar */}
        <header className="topbar">
          {/* Page title */}
          <div className="flex-1 min-w-0">
            <h1 className="h3 truncate leading-tight">
              {currentNav ? t(currentNav.labelKey as any) : "Wateen Clinic"}
            </h1>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-1.5 flex-shrink-0 ms-4">
            {/* ⌘K search pill — hidden on mobile, icon-only on sm */}
            <button
              onClick={() => setCmdOpen(true)}
              className={cn(
                "hidden sm:flex items-center gap-2 rounded-full border border-[var(--line)]",
                "bg-[var(--surface-2)] hover:bg-[var(--surface-2)] text-[var(--ink-muted)]",
                "hover:text-[var(--ink)] transition-colors text-[12px] px-3 flex-shrink-0"
              )}
              style={{ height: 34, width: 220 }}
              aria-label={t("commandPalette") || "Open command palette (⌘K)"}
            >
              <Search className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="flex-1 text-start truncate">{t("searchEllipsis") || "Search…"}</span>
              <kbd className="kbd text-[10px] hidden lg:inline-flex">⌘K</kbd>
            </button>

            {/* Icon-only search on very small screens */}
            <button
              onClick={() => setCmdOpen(true)}
              className="sm:hidden p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors"
              aria-label={t("search")}
            >
              <Search className="w-4 h-4" />
            </button>

            {/* Live clock */}
            <LiveClock language={language} />

            {/* Copy page link */}
            <button
              onClick={() => {
                if (navigator.clipboard) {
                  navigator.clipboard
                    .writeText(window.location.href)
                    .then(() => toast({ title: t("copied") || "Link copied" }));
                }
              }}
              className="p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors"
              aria-label={t("copyLink") || "Copy link"}
            >
              <Link2 className="w-4 h-4" />
            </button>

            {/* Notifications bell */}
            <Link href="/notifications">
              <div
                className="relative p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors cursor-pointer"
                aria-label={`${t("notifications")}${unreadCount > 0 ? ` (${unreadCount})` : ""}`}
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span
                    className="absolute top-1.5 end-1.5 rounded-full bg-[var(--rose-500)]"
                    style={{ width: 7, height: 7 }}
                    aria-hidden="true"
                  />
                )}
              </div>
            </Link>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>

      {/* Command palette overlay */}
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
    </div>
  );
}
