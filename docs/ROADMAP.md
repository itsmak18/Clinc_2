# Roadmap — Suggested Future Modules

1. **MFA (TOTP re-implementation)** — Design enrolment UX, mandatory gate for privileged roles, recovery flow (Phase 15)
2. **WhatsApp/SMS reminders** — via Twilio (Phase 14)
3. **Insurance billing** — extend billing table with EDI/HIPAA 837P fields (Phase 14)
4. **Patient portal** — self-booking and result viewing, separate auth domain (Phase 14)
5. **FIDO2/WebAuthn** — phish-proof login for admin/doctor roles (Phase 14)
6. **Read replicas** — separate analytics DB for reports (Phase 14)
7. **UUID PKs** — prevent business intelligence leakage, enable sharding (v3.0)
8. **Versioned Drizzle migrations** — replace `push` with `drizzle-kit migrate` for rollback-safe schema changes (v3.0)
9. **Formal HIPAA gap analysis** — if US deployment (v3.0)
