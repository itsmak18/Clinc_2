import {
  canAccessRoute,
  getLandingRoute,
  navItems,
  navPinnedByRole,
} from "@/lib/route-access";
import type { UserRole } from "@/hooks/auth";

const ALL_ROLES: UserRole[] = [
  "super_admin", "admin", "doctor", "nurse", "front_desk",
  "xray_staff", "lab_staff", "compliance_officer", "billing_manager", "pharmacist",
];

const NON_SUPER_ROLES = ALL_ROLES.filter(r => r !== "super_admin");

describe("canAccessRoute — super_admin bypass", () => {
  it("super_admin bypasses every navItems route (architectural invariant — line 219)", () => {
    for (const item of navItems) {
      expect(
        canAccessRoute(item.href, "super_admin"),
        `super_admin must reach ${item.href}`,
      ).toBe(true);
    }
  });
});

describe("canAccessRoute — per-role access matrix", () => {
  it("access decision matches navItems.roles definition for all non-super roles", () => {
    for (const item of navItems) {
      for (const role of NON_SUPER_ROLES) {
        const expected = item.roles === undefined || item.roles.includes(role);
        expect(
          canAccessRoute(item.href, role),
          `${item.href} for ${role}: expected ${expected}`,
        ).toBe(expected);
      }
    }
  });
});

describe("canAccessRoute — dashboard aliasing", () => {
  it("'/' resolves identically to '/dashboard' for every role", () => {
    for (const role of ALL_ROLES) {
      expect(canAccessRoute("/", role)).toBe(canAccessRoute("/dashboard", role));
    }
  });
});

describe("canAccessRoute — prefix matching", () => {
  it("/patients/123 inherits /patients permission for every role", () => {
    for (const role of ALL_ROLES) {
      expect(canAccessRoute("/patients/123", role)).toBe(canAccessRoute("/patients", role));
    }
  });

  it("/medical-records/456 inherits /medical-records permission for every role", () => {
    for (const role of ALL_ROLES) {
      expect(canAccessRoute("/medical-records/456", role)).toBe(
        canAccessRoute("/medical-records", role),
      );
    }
  });

  it("/xray/789 inherits /xray permission for every role", () => {
    for (const role of ALL_ROLES) {
      expect(canAccessRoute("/xray/789", role)).toBe(canAccessRoute("/xray", role));
    }
  });
});

describe("getLandingRoute", () => {
  const expectedLanding: Record<UserRole, string> = {
    doctor:             "/today",
    nurse:              "/triage",
    front_desk:         "/checkin",
    xray_staff:         "/xray",
    lab_staff:          "/lab",
    compliance_officer: "/audit",
    billing_manager:    "/billing",
    pharmacist:         "/prescriptions",
    super_admin:        "/dashboard",
    admin:              "/dashboard",
  };

  for (const [role, expected] of Object.entries(expectedLanding) as [UserRole, string][]) {
    it(`${role} → ${expected}`, () => {
      expect(getLandingRoute(role)).toBe(expected);
    });
  }

  it("every landing route is accessible to the role it serves (no role locked out of its own home)", () => {
    for (const role of ALL_ROLES) {
      const landing = getLandingRoute(role);
      expect(
        canAccessRoute(landing, role),
        `${role} denied at its own landing route ${landing}`,
      ).toBe(true);
    }
  });
});

describe("navPinnedByRole", () => {
  const navKeySet = new Set(navItems.map(n => n.key));
  const navHrefByKey = Object.fromEntries(navItems.map(n => [n.key, n.href]));

  it("every pinned key is a real navItems key", () => {
    for (const [role, keys] of Object.entries(navPinnedByRole) as [UserRole, string[]][]) {
      for (const key of keys) {
        expect(
          navKeySet.has(key),
          `navPinnedByRole[${role}] references unknown key '${key}'`,
        ).toBe(true);
      }
    }
  });

  it("every role can access its own pinned routes", () => {
    for (const [role, keys] of Object.entries(navPinnedByRole) as [UserRole, string[]][]) {
      for (const key of keys) {
        const href = navHrefByKey[key];
        if (!href) continue;
        expect(
          canAccessRoute(href, role as UserRole),
          `${role} denied at its pinned route ${href} (key: ${key})`,
        ).toBe(true);
      }
    }
  });
});
