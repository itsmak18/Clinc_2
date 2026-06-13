/**
 * load-test.js — k6 load test for MediCore (F-P6-9 / audit plan §8.5).
 *
 * Replaces the previous smoke test (which only hit /healthz/ready + /metrics and
 * so measured nothing about real clinical load). This version authenticates and
 * exercises the **dashboard + booking** paths the audit plan named, under a
 * ramped concurrent load, with separate latency thresholds for reads vs the
 * write (booking) path.
 *
 * Run:
 *   k6 run scripts/load-test.js
 *   BASE_URL=https://clinic.yourdomain.local LOGIN_USER=admin LOGIN_PASS=admin123 \
 *     k6 run scripts/load-test.js
 *
 * Env:
 *   BASE_URL    default http://localhost:5000  (API origin; routes live under /api)
 *   LOGIN_USER  default admin                  (needs dashboard + patients + booking access)
 *   LOGIN_PASS  default admin123
 *   DO_BOOKING  default "1"                    (set "0" to run read-only — booking mutates data)
 *
 * Notes:
 *  - clinic_token is HttpOnly; k6 still captures it from the login Set-Cookie in
 *    setup() and we replay it per-request via the `cookies` param (no shared jar
 *    needed across setup→VU).
 *  - CSRF is double-submit: send the `_csrf` cookie value back as X-CSRF-Token on
 *    the POST. Reads need no token.
 *  - The booking POST counts 201 (created), 409 (no doctor availability that day),
 *    and 422 (consent/validation) as *acceptable business outcomes* under load —
 *    only 5xx/401/403 are real failures. This keeps the test measuring latency &
 *    stability rather than asserting seed-data-specific success.
 */
import http from "k6/http";
import { check, group, fail } from "k6";
import { Counter, Rate } from "k6/metrics";

const BASE = (__ENV.BASE_URL || "http://localhost:5000").replace(/\/$/, "");
const API = `${BASE}/api`;
const LOGIN_USER = __ENV.LOGIN_USER || "admin";
const LOGIN_PASS = __ENV.LOGIN_PASS || "admin123";
const DO_BOOKING = (__ENV.DO_BOOKING || "1") === "1";

const bookingOutcomes = new Counter("booking_outcomes");
const bookingHardErrors = new Rate("booking_hard_errors"); // 5xx/401/403 share

export const options = {
  scenarios: {
    clinical_load: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 20 }, // ramp up
        { duration: "1m", target: 20 },  // sustain
        { duration: "30s", target: 0 },  // ramp down
      ],
      gracefulRampDown: "10s",
    },
  },
  thresholds: {
    // Reads must stay snappy; the write path is allowed more headroom.
    "http_req_duration{group:::reads}": ["p(95)<500"],
    "http_req_duration{group:::booking}": ["p(95)<1500"],
    // Across everything, fewer than 1% transport/HTTP failures.
    http_req_failed: ["rate<0.01"],
    // Booking must not 5xx/401/403 under load.
    booking_hard_errors: ["rate<0.01"],
  },
};

// ── Auth: login once, hand the cookies to every VU ──────────────────────────────
export function setup() {
  const res = http.post(
    `${API}/auth/login`,
    JSON.stringify({ username: LOGIN_USER, password: LOGIN_PASS }),
    { headers: { "Content-Type": "application/json" } },
  );
  if (res.status !== 200) {
    fail(`login failed (${res.status}) for ${LOGIN_USER} — set LOGIN_USER/LOGIN_PASS. body=${res.body}`);
  }
  const token = res.cookies?.clinic_token?.[0]?.value;
  const csrf = res.cookies?._csrf?.[0]?.value;
  if (!token || !csrf) fail("login did not set clinic_token + _csrf cookies");

  // Discover a patient + doctor id so the booking path uses real FKs.
  const cookies = { clinic_token: token, _csrf: csrf };
  let patientId, doctorId;
  const pRes = http.get(`${API}/patients?limit=20`, { cookies });
  try { patientId = (pRes.json("data") || pRes.json())?.[0]?.id; } catch (_) { /* ignore */ }
  const dRes = http.get(`${API}/schedule/doctors`, { cookies });
  try {
    const docs = dRes.json("data") || dRes.json();
    doctorId = Array.isArray(docs) ? docs[0]?.id ?? docs[0]?.doctorId : undefined;
  } catch (_) { /* ignore */ }

  return { token, csrf, patientId, doctorId };
}

export default function (data) {
  const cookies = { clinic_token: data.token, _csrf: data.csrf };

  group("reads", () => {
    const summary = http.get(`${API}/dashboard/summary`, { cookies });
    check(summary, { "dashboard summary 200": (r) => r.status === 200 });

    const activity = http.get(`${API}/dashboard/recent-activity`, { cookies });
    check(activity, { "recent-activity 200": (r) => r.status === 200 });

    const patients = http.get(`${API}/patients?limit=20`, { cookies });
    check(patients, { "patients list 200": (r) => r.status === 200 });

    const appts = http.get(`${API}/appointments?limit=20`, { cookies });
    check(appts, { "appointments list 200": (r) => r.status === 200 });

    const today = http.get(`${API}/appointments/today`, { cookies });
    check(today, { "appointments today 200": (r) => r.status === 200 });

    const docs = http.get(`${API}/schedule/doctors`, { cookies });
    check(docs, { "schedule doctors 200": (r) => r.status === 200 });
  });

  if (DO_BOOKING && data.patientId && data.doctorId) {
    group("booking", () => {
      // Schedule ~2 days out at a daytime hour to maximise availability hits.
      const when = new Date(Date.now() + 2 * 24 * 3600 * 1000);
      when.setUTCHours(10, 0, 0, 0);
      const res = http.post(
        `${API}/appointments`,
        JSON.stringify({
          patientId: data.patientId,
          doctorId: data.doctorId,
          scheduledAt: when.toISOString(),
          reason: "k6 load test booking",
          bookingSource: "walk_in",
        }),
        { cookies, headers: { "Content-Type": "application/json", "X-CSRF-Token": data.csrf } },
      );
      bookingOutcomes.add(1, { status: String(res.status) });
      const hardError = res.status >= 500 || res.status === 401 || res.status === 403;
      bookingHardErrors.add(hardError);
      check(res, {
        "booking not a hard error (no 5xx/401/403)": () => !hardError,
        "booking is an accepted outcome (201/409/422)": (r) => [201, 409, 422].includes(r.status),
      });
    });
  }
}
