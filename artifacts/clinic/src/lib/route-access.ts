import {
  LayoutDashboard, Users, CalendarDays, FileText, Pill, Scan, FlaskConical,
  Receipt, Scissors, Package, BarChart3, Bell, Shield, Settings,
  Activity, UserCog, Waves, CalendarRange, Stethoscope, ClipboardList, UserCheck, Inbox, TrendingUp, Calculator, Tag
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
    key: "today",
    href: "/today",
    icon: LayoutDashboard,
    labelKey: "today",
    roles: ["doctor"],
  },
  {
    key: "consult",
    href: "/consult",
    icon: Stethoscope,
    labelKey: "consult",
    roles: ["doctor"],
  },
  {
    key: "orders",
    href: "/orders",
    icon: ClipboardList,
    labelKey: "orders",
    roles: ["doctor"],
  },
  {
    key: "inbox",
    href: "/inbox",
    icon: Inbox,
    labelKey: "inbox",
    roles: ["doctor"],
  },
  {
    key: "checkin",
    href: "/checkin",
    icon: UserCheck,
    labelKey: "checkin",
    roles: ["super_admin", "admin", "front_desk"],
  },
  {
    key: "vitals",
    href: "/vitals",
    icon: Activity,
    labelKey: "vitalsTab",
    roles: ["super_admin", "admin", "nurse"],
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
    key: "schedule",
    href: "/schedule",
    icon: CalendarRange,
    labelKey: "schedule",
    roles: ["super_admin", "admin", "front_desk", "nurse", "doctor"],
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
    // Nurse removed 2026-06-21: vitals moved to their own table, so the nurse no
    // longer needs clinical-record access (they keep allergies on the patient card).
    roles: ["super_admin", "admin", "doctor"],
  },
  {
    key: "prescriptions",
    href: "/prescriptions",
    icon: Pill,
    labelKey: "prescriptions",
    roles: ["super_admin", "admin", "doctor", "nurse", "lab_staff", "pharmacist"],
  },
  {
    key: "xray",
    href: "/xray",
    icon: Scan,
    labelKey: "xray",
    roles: ["super_admin", "admin", "doctor", "xray_staff"],
  },
  {
    key: "ultrasound",
    href: "/ultrasound",
    icon: Waves,
    labelKey: "ultrasound",
    roles: ["super_admin", "admin", "doctor", "nurse", "xray_staff"],
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
    roles: ["super_admin", "admin", "front_desk", "billing_manager"],
  },
  {
    key: "reconciliation",
    href: "/reconciliation",
    icon: Calculator,
    labelKey: "reconciliation",
    roles: ["super_admin"],
  },
  {
    key: "service-prices",
    href: "/service-prices",
    icon: Tag,
    labelKey: "servicePrices",
    roles: ["super_admin", "admin", "billing_manager", "front_desk"],
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
    roles: ["super_admin", "admin", "doctor", "billing_manager"],
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
    roles: ["super_admin", "compliance_officer"],
  },
  {
    key: "analytics",
    href: "/analytics",
    icon: TrendingUp,
    labelKey: "analytics",
    roles: ["super_admin", "admin", "doctor"],
  },
  {
    key: "settings",
    href: "/settings",
    icon: Settings,
    labelKey: "settings",
    roles: ["super_admin", "admin"],
  },
];

export function getLandingRoute(role: UserRole): string {
  switch (role) {
    case "doctor":             return "/today";
    case "nurse":              return "/triage";
    case "front_desk":         return "/checkin";
    case "xray_staff":         return "/xray";
    case "lab_staff":          return "/lab";
    case "compliance_officer": return "/audit";
    case "billing_manager":    return "/billing";
    case "pharmacist":         return "/prescriptions";
    default:                   return "/dashboard";
  }
}

export const navPinnedByRole: Partial<Record<UserRole, string[]>> = {
  nurse:              ["triage", "vitals", "patients", "appointments"],
  front_desk:         ["checkin", "appointments", "patients", "billing"],
  xray_staff:         ["xray", "patients", "appointments"],
  lab_staff:          ["lab", "patients", "appointments"],
  compliance_officer: ["audit"],
  billing_manager:    ["billing"],
  pharmacist:         ["prescriptions"],
  doctor:             ["today", "schedule", "patients", "consult", "orders", "inbox", "analytics"],
};

export function canAccessRoute(href: string, role: UserRole): boolean {
  // super_admin MUST bypass ALL route guards — architectural invariant.
  if (role === "super_admin") return true;
  const item = navItems.find(n => {
    if (n.href === "/dashboard") return href === "/" || href === "/dashboard";
    return href === n.href || href.startsWith(n.href + "/");
  });
  if (!item || !item.roles) return true;
  return item.roles.includes(role);
}

