/**
 * route-access.contract.test.ts — client ↔ server RBAC parity (F-P7-2).
 *
 * Phase 7's first pass claimed parity was "programmatically verified by
 * route-access.contract.test.ts" — but that file did not exist, and the real
 * route-access.test.ts only checks client-side consistency. This is that test.
 *
 * The client guard (`canAccessRoute` / `navItems.roles`) is UX-only; the backend
 * `requireRole`/`authGate` is the real boundary. The security-relevant invariant
 * is therefore: **no role may see a client route whose backing backend endpoint
 * would refuse it** (client roles ⊆ backend roles). A client route that is MORE
 * permissive than its backend is at best a "click → 403" UX bug and at worst an
 * info-leak about which features exist.
 *
 * `BACKEND_CONTRACT` below is a hand-verified snapshot of the backend gate for the
 * primary GET endpoint that backs each client page, taken 2026-06-07 with the
 * cited `routes/*.ts:line` source. It is NOT auto-derived (Express middleware role
 * sets are captured in closures and aren't introspectable without a registry), so
 * **when you change a route's `requireRole`/`authGate`, update the matching entry
 * here.** This test pins the client side hard: widening a `navItems.roles` set
 * beyond its backend without updating the contract fails CI.
 */
import { navItems } from "@/lib/route-access";
import type { UserRole } from "@/hooks/auth";

const ALL_ROLES: UserRole[] = [
  "super_admin", "admin", "doctor", "nurse", "front_desk",
  "xray_staff", "lab_staff", "compliance_officer", "billing_manager", "pharmacist",
];

// "ANY_AUTH"     — endpoint gated only by requireAuth (every authenticated role).
// "CLIENT_ONLY"  — page has no dedicated backend data endpoint (e.g. local theme).
// UserRole[]     — exact backend role set for the page's primary GET.
type BackendRoles = UserRole[] | "ANY_AUTH" | "CLIENT_ONLY";

interface Contract { roles: BackendRoles; source: string }

const BACKEND_CONTRACT: Record<string, Contract> = {
  "/dashboard":        { roles: "ANY_AUTH",                                                              source: "dashboard.ts:9 GET /dashboard/summary (requireAuth)" },
  "/today":            { roles: ["super_admin", "admin", "doctor", "nurse", "front_desk", "lab_staff", "xray_staff"], source: "appointments.ts:17 router.use(/appointments) gate" },
  "/consult":          { roles: ["super_admin", "admin", "doctor", "nurse"],                             source: "medical_records.ts:16 GET /medical-records" },
  "/orders":           { roles: ["super_admin", "admin", "doctor", "nurse", "xray_staff"],               source: "xray.ts:12 / lab.ts:12 use-gate (doctor order surface)" },
  "/inbox":            { roles: "ANY_AUTH",                                                              source: "notifications.ts:53 GET /notifications (requireAuth)" },
  "/checkin":          { roles: ["super_admin", "admin", "doctor", "nurse", "front_desk", "lab_staff", "xray_staff"], source: "appointments.ts:17 use-gate (+ checkin mutation sa/admin/front_desk)" },
  "/vitals":           { roles: ["super_admin", "admin", "doctor", "nurse"],                             source: "medical_records.ts:16 GET /medical-records (nurse vitals entry)" },
  "/patients":         { roles: ["super_admin", "admin", "doctor", "nurse", "front_desk", "lab_staff", "xray_staff"], source: "patients.ts:17 GET /patients" },
  "/appointments":     { roles: ["super_admin", "admin", "doctor", "nurse", "front_desk", "lab_staff", "xray_staff"], source: "appointments.ts:17 use-gate" },
  "/schedule":         { roles: ["super_admin", "admin", "front_desk", "nurse", "doctor"],               source: "schedule.ts:23 READ_ROLES" },
  "/triage":           { roles: ["super_admin", "admin", "doctor", "nurse", "front_desk"],               source: "appointments.ts:29 GET /appointments/flow" },
  "/medical-records":  { roles: ["super_admin", "admin", "doctor", "nurse"],                             source: "medical_records.ts:16 GET /medical-records" },
  "/prescriptions":    { roles: ["super_admin", "admin", "doctor", "nurse", "lab_staff", "pharmacist"],  source: "prescriptions.ts:21 GET /prescriptions" },
  "/xray":             { roles: ["super_admin", "admin", "doctor", "nurse", "xray_staff"],               source: "xray.ts:12 router.use(/xray) gate" },
  "/ultrasound":       { roles: ["super_admin", "admin", "doctor", "nurse", "xray_staff"],               source: "ultrasound.ts:12 router.use(/ultrasound) gate" },
  "/lab":              { roles: ["super_admin", "admin", "doctor", "nurse", "lab_staff"],                source: "lab.ts:12 router.use(/lab) gate" },
  "/billing":          { roles: ["super_admin", "admin", "front_desk", "billing_manager"],              source: "billing.ts:16 GET /billing/invoices" },
  "/operations":       { roles: ["super_admin", "admin", "doctor", "nurse"],                             source: "operations.ts:15 GET /operations" },
  "/inventory":        { roles: ["super_admin", "admin", "doctor", "nurse", "lab_staff", "xray_staff"],  source: "inventory.ts:22 GET /inventory" },
  "/reports":          { roles: ["super_admin", "admin", "doctor"],                                      source: "reports.ts:8 router.use(/reports) gate" },
  "/notifications":    { roles: "ANY_AUTH",                                                              source: "notifications.ts:53 GET /notifications (requireAuth)" },
  "/users":            { roles: ["super_admin", "admin", "front_desk", "nurse"],                         source: "users.ts:20 GET /users" },
  "/audit":            { roles: ["super_admin", "compliance_officer"],                                   source: "audit.ts:8 router.use(/audit-logs) gate" },
  // analytics: route-layer requireRole (2026-06-07) — list super_admin/admin,
  // per-doctor super_admin/admin/doctor — backed by the finer service-layer gate
  // (listDoctorAnalytics super_admin/admin :323; getDoctorAnalytics doctor-own :290-294).
  "/analytics":        { roles: ["super_admin", "admin", "doctor"],                                      source: "analytics.ts requireRole + analytics.service.ts:323,290-294" },
  "/settings":         { roles: "CLIENT_ONLY",                                                           source: "no backend data route — local theme/tweaks page" },
};

describe("RBAC parity — client navItems ⊆ backend route roles (F-P7-2)", () => {
  it("every client nav route has a declared backend contract (no orphan routes)", () => {
    const missing = navItems.filter(n => !(n.href in BACKEND_CONTRACT)).map(n => n.href);
    expect(
      missing,
      `Client nav routes with no BACKEND_CONTRACT entry — add one (with its backend gate) so parity is verified: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("no client route is MORE permissive than its backend (client roles ⊆ backend roles)", () => {
    const violations: string[] = [];

    for (const item of navItems) {
      const contract = BACKEND_CONTRACT[item.href];
      if (!contract) continue; // covered by the orphan test above
      if (contract.roles === "CLIENT_ONLY" || contract.roles === "ANY_AUTH") continue;

      // A nav item with no `roles` is visible to ALL roles; the backend must then
      // also allow all roles (ANY_AUTH). If it doesn't, that's a parity violation.
      const clientRoles: UserRole[] = item.roles ?? ALL_ROLES;
      const backend = new Set<UserRole>(contract.roles);

      for (const role of clientRoles) {
        if (role === "super_admin") continue; // backend requireRole always includes super_admin
        if (!backend.has(role)) {
          violations.push(
            `${item.href}: client allows "${role}" but backend (${contract.source}) does not → role would be 403'd or sees a hidden feature`,
          );
        }
      }
    }

    expect(violations, `RBAC parity violations:\n  ${violations.join("\n  ")}`).toEqual([]);
  });

  it("routes visible to all roles (no nav `roles`) are backed by an ANY_AUTH endpoint", () => {
    const offenders = navItems
      .filter(n => !n.roles) // visible to everyone client-side
      .filter(n => {
        const c = BACKEND_CONTRACT[n.href];
        return c && c.roles !== "ANY_AUTH" && c.roles !== "CLIENT_ONLY";
      })
      .map(n => n.href);
    expect(
      offenders,
      `These routes are visible to all roles client-side but their backend restricts roles — either gate the nav item or confirm the backend is ANY_AUTH: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
