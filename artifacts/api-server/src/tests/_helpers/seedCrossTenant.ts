/**
 * Cross-tenant test fixture.
 *
 * Two clinics, two users per clinic (doctor + super_admin), one patient per
 * clinic, and a paid-status invoice per clinic. Just enough surface to prove
 * that every list/get endpoint refuses to leak rows across the clinic
 * boundary.
 *
 * Returns identifiers the test asserts on.
 */
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  clinicsTable, usersTable, patientsTable, invoicesTable,
} from "@workspace/db";
import { hashPassword } from "../../lib/password";

export interface CrossTenantSeed {
  clinicA: { id: number };
  clinicB: { id: number };
  superAdminA: { id: number; username: string; clinicId: number };
  superAdminB: { id: number; username: string; clinicId: number };
  doctorA: { id: number; username: string; clinicId: number };
  doctorB: { id: number; username: string; clinicId: number };
  patientA: { id: number; clinicId: number };
  patientB: { id: number; clinicId: number };
  invoiceA: { id: number; clinicId: number };
  invoiceB: { id: number; clinicId: number };
}

export async function seedCrossTenant(db: NodePgDatabase<Record<string, never>>): Promise<CrossTenantSeed> {
  // Drizzle migrations already insert a seed clinic id=1 in some migrations,
  // so we treat id=1 as Clinic A (matches the policy kernel test default) and
  // create a brand-new Clinic B.
  const existing = await db.select({ id: clinicsTable.id }).from(clinicsTable);
  let clinicAId: number;
  if (existing.find(r => r.id === 1)) {
    clinicAId = 1;
  } else {
    const [a] = await db.insert(clinicsTable).values({ name: "Clinic A" }).returning();
    clinicAId = a.id;
  }
  const [b] = await db.insert(clinicsTable).values({ name: "Clinic B" }).returning();
  const clinicBId = b.id;

  const pw = await hashPassword("test_password_123!");

  const [superAdminA] = await db.insert(usersTable).values({
    username: "sa_a", fullName: "Super Admin A", passwordHash: pw, role: "super_admin", clinicId: clinicAId,
  }).returning();
  const [superAdminB] = await db.insert(usersTable).values({
    username: "sa_b", fullName: "Super Admin B", passwordHash: pw, role: "super_admin", clinicId: clinicBId,
  }).returning();
  const [doctorA] = await db.insert(usersTable).values({
    username: "dr_a", fullName: "Doctor A", passwordHash: pw, role: "doctor", clinicId: clinicAId,
  }).returning();
  const [doctorB] = await db.insert(usersTable).values({
    username: "dr_b", fullName: "Doctor B", passwordHash: pw, role: "doctor", clinicId: clinicBId,
  }).returning();

  const [patientA] = await db.insert(patientsTable).values({
    clinicId: clinicAId, mrn: "MRN-A-001", idCardNumber: "ID-A-001", fullName: "Patient A", dateOfBirth: "1990-01-01",
    gender: "male", phone: "+1-555-0001",
  }).returning();
  const [patientB] = await db.insert(patientsTable).values({
    clinicId: clinicBId, mrn: "MRN-B-001", idCardNumber: "ID-B-001", fullName: "Patient B", dateOfBirth: "1991-02-02",
    gender: "female", phone: "+1-555-0002",
  }).returning();

  const [invoiceA] = await db.insert(invoicesTable).values({
    clinicId: clinicAId, patientId: patientA.id, invoiceNumber: "INV-A-001",
    subtotal: "100.00", discount: "0.00", total: "100.00", status: "pending",
    createdById: superAdminA.id,
  }).returning();
  const [invoiceB] = await db.insert(invoicesTable).values({
    clinicId: clinicBId, patientId: patientB.id, invoiceNumber: "INV-B-001",
    subtotal: "200.00", discount: "0.00", total: "200.00", status: "pending",
    createdById: superAdminB.id,
  }).returning();

  return {
    clinicA: { id: clinicAId },
    clinicB: { id: clinicBId },
    superAdminA: { id: superAdminA.id, username: superAdminA.username, clinicId: clinicAId },
    superAdminB: { id: superAdminB.id, username: superAdminB.username, clinicId: clinicBId },
    doctorA: { id: doctorA.id, username: doctorA.username, clinicId: clinicAId },
    doctorB: { id: doctorB.id, username: doctorB.username, clinicId: clinicBId },
    patientA: { id: patientA.id, clinicId: clinicAId },
    patientB: { id: patientB.id, clinicId: clinicBId },
    invoiceA: { id: invoiceA.id, clinicId: clinicAId },
    invoiceB: { id: invoiceB.id, clinicId: clinicBId },
  };
}
