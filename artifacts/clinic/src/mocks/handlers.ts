/**
 * MSW request handlers for the Playwright E2E suite (AUD-FE-01).
 *
 * Response shapes are copied from lib/api-spec/openapi.yaml — the actual API
 * contract, not guessed — so a shape mismatch surfaces as a component bug
 * during E2E, not a mock bug. Session state is a plain in-memory variable, not
 * a real cookie: the app reads its auth state entirely from GET /api/auth/me's
 * JSON body (never from the HttpOnly cookie, which client JS can't read
 * anyway — see hooks/auth.tsx), so a real cookie jar isn't needed to simulate
 * "logged in". CSRF is likewise not enforced here — custom-fetch.ts only
 * attaches the header when an `_csrf` cookie exists; these handlers never set
 * one and never check for the header, so mutations succeed unconditionally.
 *
 * Default state is LOGGED OUT (GET /api/auth/me -> 401) so the login spec
 * exercises the real form; other specs authenticate via e2e/fixtures.ts.
 */
import { http, HttpResponse } from "msw";

// ── Seed users (usernames match the real dev seed table in CLAUDE.md, so the
// login form behaves like a real dev environment) ───────────────────────────
const SEED_USERS: Record<string, { id: number; fullName: string; role: string }> = {
  admin:        { id: 2,  fullName: "Admin User",   role: "admin" },
  superadmin:   { id: 1,  fullName: "Super Admin",  role: "super_admin" },
  receptionist: { id: 6,  fullName: "Front Desk",   role: "front_desk" },
  dr_ahmed:     { id: 3,  fullName: "Dr Ahmed",     role: "doctor" },
};

function userResponse(seed: { id: number; fullName: string; role: string }) {
  return {
    id: seed.id,
    username: Object.keys(SEED_USERS).find(k => SEED_USERS[k] === seed)!,
    fullName: seed.fullName,
    role: seed.role,
    isActive: true,
    isOnShift: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

// ── Session state (module-level, reset per Playwright worker/page context) ──
let currentUser: ReturnType<typeof userResponse> | null = null;

// ── In-memory stores mutated by POST handlers so a created row is visible to
// the very next GET (list) call, proving the create -> refetch -> render loop. ──
let nextAppointmentId = 1000;
const appointmentsStore: Record<string, unknown>[] = [];

let nextInvoiceId = 2000;
const invoicesStore: Record<string, unknown>[] = [];

// ── Seed reference data ──────────────────────────────────────────────────────
const MOCK_PATIENTS = [
  { id: 501, mrn: "MRN-E2E-501", idCardNumber: "ID-E2E-501", fullName: "Fatima Al-Otaibi", fullNameAr: "فاطمة العتيبي", dateOfBirth: "1990-04-12", gender: "female", phone: "+966500000501", address: null, bloodType: null, allergies: null, emergencyContact: null, isActive: true, createdAt: "2026-01-01T00:00:00.000Z" },
  { id: 502, mrn: "MRN-E2E-502", idCardNumber: "ID-E2E-502", fullName: "Khalid Al-Harbi", fullNameAr: "خالد الحربي", dateOfBirth: "1985-09-03", gender: "male", phone: "+966500000502", address: null, bloodType: null, allergies: null, emergencyContact: null, isActive: true, createdAt: "2026-01-01T00:00:00.000Z" },
];

const MOCK_DOCTORS = [
  { id: 3, username: "dr_ahmed", fullName: "Dr Ahmed", role: "doctor", isActive: true, isOnShift: true, createdAt: "2026-01-01T00:00:00.000Z" },
];

const MOCK_SERVICES = [
  { id: 701, name: "Consultation", nameAr: "استشارة",        description: null, defaultPrice: "150", category: "General", code: "CONSULT", active: true, createdAt: "2026-01-01T00:00:00.000Z" },
  { id: 702, name: "Lab Test",     nameAr: "اختبار معملي",   description: null, defaultPrice: "50",  category: "Lab",     code: "LAB01",   active: true, createdAt: "2026-01-01T00:00:00.000Z" },
];

export const handlers = [
  // ── Auth ────────────────────────────────────────────────────────────────
  http.post("/api/auth/login", async ({ request }) => {
    const body = (await request.json()) as { username?: string; password?: string };
    const seed = body.username ? SEED_USERS[body.username] : undefined;
    if (!seed || !body.password) {
      return HttpResponse.json({ message: "Invalid credentials" }, { status: 401 });
    }
    currentUser = userResponse(seed);
    return HttpResponse.json({ user: currentUser });
  }),

  http.get("/api/auth/me", () => {
    if (!currentUser) return new HttpResponse(null, { status: 401 });
    return HttpResponse.json(currentUser);
  }),

  http.post("/api/auth/logout", () => {
    currentUser = null;
    return HttpResponse.json({ success: true });
  }),

  // ── Dashboard (admin/super_admin fallthrough view) ─────────────────────
  http.get("/api/dashboard/summary", () =>
    HttpResponse.json({
      todayAppointments: 12, checkedInPatients: 4, pendingLabTests: 2, pendingXrays: 1,
      todayRevenue: 4200, yesterdayRevenue: 3800, pendingInvoices: 3, scheduledOperations: 0,
      lowStockItems: 0, totalPatients: 245, totalDoctors: 1,
    }),
  ),
  http.get("/api/dashboard/recent-activity", () => HttpResponse.json([])),
  http.get("/api/dashboard/department-load", () =>
    HttpResponse.json([{ doctorId: 3, doctorName: "Dr Ahmed", count: 5 }]),
  ),
  http.get("/api/appointments/flow", () =>
    HttpResponse.json({
      stageCounts: {
        scheduled: 3, checked_in: 1, in_triage: 0, ready_for_doctor: 0, in_consultation: 0,
        awaiting_diagnostics: 0, pending_payment: 0, completed: 2, cancelled: 0,
      },
      avgWaitMins: { arrivalToTriage: null, triageToConsultation: null, consultationToPayment: null },
      totalToday: 6, activePatients: 4, refreshedAt: new Date().toISOString(),
    }),
  ),
  http.get("/api/users/on-shift", () => HttpResponse.json(MOCK_DOCTORS)),
  http.get("/api/dashboard/front-desk", () =>
    HttpResponse.json({
      totalToday: appointmentsStore.length,
      statusCounts: { scheduled: appointmentsStore.length, checked_in: 0, completed: 0, cancelled: 0, no_show: 0, in_progress: 0 },
      sourceCounts: { walk_in: appointmentsStore.length, phone: 0, online: 0 },
    }),
  ),

  // ── Authed-shell background polling ─────────────────────────────────────────
  // The Layout (rendered after login) polls notifications and opens an SSE
  // stream. Without handlers these fall through MSW to the dead vite proxy →
  // ECONNREFUSED spam + a 5s EventSource reconnect storm. Empty list + a
  // never-closing event-stream keep the shell quiet during E2E.
  http.get("/api/notifications", () => HttpResponse.json([])),
  http.get("/api/notifications/stream", () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(": e2e-mock-stream\n\n"));
        // Intentionally left open — EventSource stays connected, no reconnect.
      },
    });
    return new HttpResponse(stream, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
    });
  }),

  http.get("/api/appointments/today", () =>
    HttpResponse.json({
      appointments: appointmentsStore,
      total: appointmentsStore.length,
      scheduled: appointmentsStore.filter(a => a.status === "scheduled").length,
      checkedIn: 0, completed: 0, cancelled: 0,
    }),
  ),

  // ── Patients (bulk `?limit=200` AND typeahead `?search=X&limit=20` share
  // this one handler, matching the real /patients endpoint's single shape) ──
  http.get("/api/patients", ({ request }) => {
    const url = new URL(request.url);
    const search = url.searchParams.get("search")?.toLowerCase();
    const patients = search
      ? MOCK_PATIENTS.filter(p => p.fullName.toLowerCase().includes(search))
      : MOCK_PATIENTS;
    return HttpResponse.json({ patients, total: patients.length, nextCursor: null });
  }),

  // ── Users (doctor picker) ────────────────────────────────────────────────
  http.get("/api/users", ({ request }) => {
    const role = new URL(request.url).searchParams.get("role");
    return HttpResponse.json(role === "doctor" ? MOCK_DOCTORS : []);
  }),

  // ── Appointments ──────────────────────────────────────────────────────────
  http.get("/api/appointments", () =>
    HttpResponse.json({ data: appointmentsStore, nextCursor: null }),
  ),
  http.post("/api/appointments", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const patient = MOCK_PATIENTS.find(p => p.id === Number(body.patientId));
    const doctor = MOCK_DOCTORS.find(d => d.id === Number(body.doctorId));
    const appointment = {
      id: nextAppointmentId++,
      patientId: Number(body.patientId),
      doctorId: Number(body.doctorId),
      patient, doctor,
      scheduledAt: body.scheduledAt,
      reason: body.reason ?? "",
      status: "scheduled",
      bookingSource: body.bookingSource ?? "walk_in",
      notes: body.notes ?? null,
      createdAt: new Date().toISOString(),
    };
    appointmentsStore.unshift(appointment);
    return HttpResponse.json(appointment, { status: 201 });
  }),

  // ── Billing ───────────────────────────────────────────────────────────────
  http.get("/api/services-catalog", () =>
    HttpResponse.json({ data: MOCK_SERVICES, nextCursor: null }),
  ),
  http.get("/api/billing/invoices", () => HttpResponse.json(invoicesStore)),
  http.get("/api/billing/daily-summary", () =>
    HttpResponse.json({
      date: new Date().toISOString().split("T")[0],
      totalRevenue: invoicesStore.reduce((s, i) => s + Number((i as { total: number }).total), 0),
      totalInvoices: invoicesStore.length,
      paidInvoices: invoicesStore.filter(i => i.status === "paid").length,
      pendingInvoices: invoicesStore.filter(i => i.status === "pending").length,
      cashReceipts: [],
    }),
  ),
  http.post("/api/billing/invoices", async ({ request }) => {
    const body = (await request.json()) as {
      patientId: number; items: Array<{ description: string; quantity: number; unitPrice: number }>;
      discount?: number; markPaid?: boolean;
    };
    const items = body.items.map(i => ({ ...i, total: i.quantity * i.unitPrice }));
    const subtotal = items.reduce((s, i) => s + i.total, 0);
    const discount = body.discount ?? 0;
    const patient = MOCK_PATIENTS.find(p => p.id === Number(body.patientId));
    const invoice = {
      id: nextInvoiceId++,
      invoiceNumber: `INV-E2E-${nextInvoiceId}`,
      patientId: body.patientId,
      patient, // Billing.tsx's list renders inv.patient?.fullName, falling back to
               // #{patientId} when absent — must embed it, same as the appointment
               // handler above, or a created row shows the id instead of the name.
      createdById: currentUser?.id ?? 0,
      items,
      subtotal,
      discount,
      total: subtotal - discount,
      status: body.markPaid ? "paid" : "pending",
      paidAt: body.markPaid ? new Date().toISOString() : null,
      notes: null,
      createdAt: new Date().toISOString(),
    };
    invoicesStore.unshift(invoice);
    return HttpResponse.json(invoice, { status: 201 });
  }),
];
