import { Link, useLocation } from "wouter";
import { useAuth, UserRole } from "@/hooks/auth";
import { useI18n } from "@/hooks/i18n";
import { useNotificationsStream, registerToastForSSE } from "@/hooks/use-notifications-stream";
import { useIdleTimeout } from "@/hooks/use-idle-timeout";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { useListNotifications, getListNotificationsQueryKey } from "@workspace/api-client-react";
import {
  LayoutDashboard, Users, CalendarDays, FileText, Pill, Scan, FlaskConical,
  Receipt, Scissors, Package, BarChart3, Bell, Shield, Settings, LogOut,
  Globe, Activity, UserCog
} from "lucide-react";
import GlobalSearch from "@/components/GlobalSearch";

export interface NavItem {
  key: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  labelKey: string;
  roles?: UserRole[];
}

export const navItems: NavItem[] = [
  {
    key: "dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
    labelKey: "dashboard",
    // all roles — no restriction
  },
  {
    key: "patients",
    href: "/patients",
    icon: Users,
    labelKey: "patients",
    roles: ["super_admin", "admin", "doctor", "nurse", "front_desk"],
  },
  {
    key: "appointments",
    href: "/appointments",
    icon: CalendarDays,
    labelKey: "appointments",
    roles: ["super_admin", "admin", "doctor", "nurse", "front_desk"],
  },
  {
    key: "triage",
    href: "/triage",
    icon: Activity,
    labelKey: "triage",
    roles: ["super_admin", "admin", "nurse", "front_desk"],
  },
  {
    key: "medical-records",
    href: "/medical-records",
    icon: FileText,
    labelKey: "medicalRecords",
    roles: ["super_admin", "admin", "doctor", "nurse"],
  },
  {
    key: "prescriptions",
    href: "/prescriptions",
    icon: Pill,
    labelKey: "prescriptions",
    roles: ["super_admin", "admin", "doctor"],
  },
  {
    key: "xray",
    href: "/xray",
    icon: Scan,
    labelKey: "xray",
    roles: ["super_admin", "admin", "doctor", "xray_staff"],
  },
  {
    key: "lab",
    href: "/lab",
    icon: FlaskConical,
    labelKey: "lab",
    roles: ["super_admin", "admin", "doctor", "lab_staff"],
  },
  {
    key: "billing",
    href: "/billing",
    icon: Receipt,
    labelKey: "billing",
    roles: ["super_admin", "admin", "front_desk"],
  },
  {
    key: "operations",
    href: "/operations",
    icon: Scissors,
    labelKey: "operations",
    roles: ["super_admin", "admin", "doctor"],
  },
  {
    key: "inventory",
    href: "/inventory",
    icon: Package,
    labelKey: "inventory",
    roles: ["super_admin", "admin"],
  },
  {
    key: "reports",
    href: "/reports",
    icon: BarChart3,
    labelKey: "reports",
    roles: ["super_admin", "admin", "doctor"],
  },
  {
    key: "notifications",
    href: "/notifications",
    icon: Bell,
    labelKey: "notifications",
    // all roles — no restriction
  },
  {
    key: "users",
    href: "/users",
    icon: UserCog,
    labelKey: "users",
    roles: ["super_admin", "admin"],
  },
  {
    key: "audit",
    href: "/audit",
    icon: Shield,
    labelKey: "audit",
    roles: ["super_admin"],
  },
  {
    key: "settings",
    href: "/settings",
    icon: Settings,
    labelKey: "settings",
    roles: ["super_admin", "admin"],
  },
];

export function canAccessRoute(href: string, role: UserRole): boolean {
  const item = navItems.find(n => {
    if (n.href === "/dashboard") return href === "/" || href === "/dashboard";
    return href === n.href || href.startsWith(n.href + "/");
  });
  if (!item || !item.roles) return true;
  return item.roles.includes(role);
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const { t, language, setLanguage, isRtl } = useI18n();
  const [location] = useLocation();
  const { toast } = useToast();

  useNotificationsStream();
  registerToastForSSE(({ title, description }) => toast({ title, description }));
  useIdleTimeout(logout, !!user);

  const { data: notifications } = useListNotifications(
    { unreadOnly: true },
    { query: { queryKey: getListNotificationsQueryKey({ unreadOnly: true }) } }
  );
  const unreadCount = notifications?.length ?? 0;

  const visibleItems = navItems.filter(item => {
    if (!item.roles) return true;
    return user && item.roles.includes(user.role);
  });

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
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
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
      <main className="flex-1 overflow-y-auto scrollbar-thin">
        {children}
      </main>
    </div>
  );
}
