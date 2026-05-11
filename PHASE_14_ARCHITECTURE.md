# MediCore v3.0: Long-Term Evolution Architecture (Phase 14)

This document serves as the technical specification for the post-launch features designated in Phase 14.

## 1. Event-Driven Architecture (Clinical State Transitions)
**Objective:** Decouple monolithic services into domain events.
- **Tech Stack:** Kafka or Redis Streams.
- **Implementation:** When an appointment status changes to `completed`, publish an `AppointmentCompletedEvent`. Microservices (Billing, Recall, Analytics) subscribe to this stream, removing direct API dependencies from the appointment handlers.

## 2. Read Replicas & CQRS for Analytics
**Objective:** Prevent analytical dashboard queries from starving transactional DB pool.
- **Implementation:** Configure PostgreSQL logical replication to a read-only instance. Dashboard metrics, financial aggregations, and `EXPLAIN ANALYZE` optimizations will exclusively target the read replica URL, keeping the primary instance dedicated to write mutations.

## 3. Patient Portal
**Objective:** Allow patients to view their own records and book appointments.
- **Architecture:** A new Next.js or React application hosted on a distinct domain (e.g., `portal.clinic.com`).
- **Auth:** Distinct JWT scopes with `aud` (audience) restricted to the portal to ensure a compromised portal token cannot be used in the staff dashboard.

## 4. Twilio SMS Reminders
**Objective:** Reduce patient no-shows.
- **Implementation:** Integrate `twilio` SDK. A new background worker in `src/cron.ts` will poll appointments starting in 24 hours and trigger an SMS webhook. 
- **Privacy Constraint:** No PHI in SMS payloads. Message format: "You have an appointment at MediCore tomorrow at 10:00 AM."

## 5. Insurance Billing Extension
**Objective:** Direct integration with regional health insurance clearhouses.
- **Implementation:** Expand `billing.ts` to generate EDI (Electronic Data Interchange) formats like HIPAA 837P.

## 6. FIDO2 / WebAuthn
**Objective:** Phish-proof authentication for `super_admin` and `doctor` roles.
- **Implementation:** Implement `@simplewebauthn/server` and `@simplewebauthn/browser` for passwordless hardware key (YubiKey) or biometric (FaceID) login.

## 7. AI-Assisted Triage
**Objective:** Provide symptomatic recommendations to nurses during intake.
- **Architecture:** OpenAI/Anthropic API integration with strict HIPAA Business Associate Agreements (BAA).
- **Compliance:** AI is strictly *advisory*. Every AI response must be appended to the `audit_logs` with the exact prompt used.

## 8. UUID Migration
**Objective:** Prevent business intelligence leakage (predictable serial IDs) and enable database sharding.
- **Process:** Generate a new schema where `id` is `uuid DEFAULT gen_random_uuid()`. Migrate data, then update foreign keys.

## 9. Formal HIPAA Gap Analysis
**Objective:** Achieve formal healthcare compliance.
- **Process:** Retain external security auditors to verify at-rest encryption, transit encryption, BAA presence, and access control policies (which we've hardened in Phases 1-12).
