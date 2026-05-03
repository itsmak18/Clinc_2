import {
  LayoutDashboard, Users, CalendarDays, FileText, Pill, Scan, FlaskConical,
  Receipt, Scissors, Package, BarChart3, Bell, Shield, Settings,
  Activity, UserCog
} from "lucide-react";
import type { UserRole } from "@/hooks/auth";

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
  },
  {
    key: "patients",
    href: "/patients",
    icon: Users,
    labelKey: "patients",
    roles: ["super_admin", "admin", "doctor", "nurse", "front_desk", "lab_staff", "xray_staff"],
  },
  {
    key: "appointments",
    href: "/appointments",
    icon: CalendarDays,
    labelKey: "appointments",
    roles: ["super_admin", "admin", "doctor", "nurse", "front_desk", "lab_staff", "xray_staff"],
  },
  {
    key: "triage",
    href: "/triage",
    icon: Activity,
    labelKey: "triage",
    roles: ["super_admin", "admin", "nurse"],
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
    roles: ["super_admin", "admin", "doctor", "nurse", "lab_staff"],
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
    roles: ["super_admin", "admin", "doctor", "nurse"],
  },
  {
    key: "inventory",
    href: "/inventory",
    icon: Package,
    labelKey: "inventory",
    roles: ["super_admin", "admin", "doctor", "nurse", "lab_staff", "xray_staff"],
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
