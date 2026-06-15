import { db, sql } from "@workspace/db";
import {
  clinicsTable,
  usersTable, patientsTable, appointmentsTable, inventoryTable,
  notificationsTable
} from "@workspace/db";
import bcrypt from "bcrypt";

const BCRYPT_ROUNDS = 12;

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

async function seed() {
  console.log("Seeding database...");

  // Bootstrap login_attempts table (idempotent)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS login_attempts (
      key          TEXT PRIMARY KEY,
      count        INTEGER NOT NULL DEFAULT 0,
      first_seen   TIMESTAMPTZ NOT NULL,
      locked_until TIMESTAMPTZ,
      updated_at   TIMESTAMPTZ NOT NULL
    )
  `);

  // Bootstrap sequences (idempotent)
  await db.execute(sql`CREATE SEQUENCE IF NOT EXISTS invoice_seq START WITH 1000`);
  await db.execute(sql`CREATE SEQUENCE IF NOT EXISTS mrn_seq START WITH 1001`);

  // Clear existing data for a clean re-seed
  console.log("Clearing existing data...");
  await db.execute(sql`TRUNCATE TABLE notifications, inventory, appointments, patients, users, clinics RESTART IDENTITY CASCADE`);

  // The default clinic must exist before any PHI row — every clinic-bearing table
  // has clinic_id NOT NULL REFERENCES clinics(id). The schema DEFAULT 1 was
  // removed (migration 0027) so every insert below now sets clinicId explicitly.
  console.log("Creating default clinic...");
  const [clinic] = await db.insert(clinicsTable).values({
    name: "Default Clinic",
    nameAr: "العيادة الافتراضية",
  }).returning();
  const clinicId = clinic.id;

  // Users
  console.log("Creating users with bcrypt hashes...");
  const [superAdmin, admin, doctor1, doctor2, nurse, frontDesk, xrayStaff, labStaff] = await db.insert(usersTable).values([
    { clinicId, username: "superadmin", passwordHash: await hashPassword("admin123"), fullName: "Super Administrator", fullNameAr: "مشرف عام", email: "superadmin@medicore.com", role: "super_admin" },
    { clinicId, username: "admin", passwordHash: await hashPassword("admin123"), fullName: "Admin User", fullNameAr: "مشرف", email: "admin@medicore.com", role: "admin" },
    { clinicId, username: "dr_ahmed", passwordHash: await hashPassword("doctor123"), fullName: "Dr. Ahmed Al-Rashidi", fullNameAr: "د. أحمد الراشدي", email: "ahmed@medicore.com", role: "doctor", phone: "+966501234567" },
    { clinicId, username: "dr_sara", passwordHash: await hashPassword("doctor123"), fullName: "Dr. Sara Al-Nasser", fullNameAr: "د. سارة الناصر", email: "sara@medicore.com", role: "doctor", phone: "+966502234567" },
    { clinicId, username: "nurse1", passwordHash: await hashPassword("nurse123"), fullName: "Fatima Al-Zahra", fullNameAr: "فاطمة الزهراء", email: "fatima@medicore.com", role: "nurse" },
    { clinicId, username: "receptionist", passwordHash: await hashPassword("front123"), fullName: "Omar Al-Farouk", fullNameAr: "عمر الفاروق", email: "omar@medicore.com", role: "front_desk" },
    { clinicId, username: "xray_tech", passwordHash: await hashPassword("xray123"), fullName: "Khalid Al-Mutairi", fullNameAr: "خالد المطيري", email: "khalid@medicore.com", role: "xray_staff" },
    { clinicId, username: "lab_tech", passwordHash: await hashPassword("lab123"), fullName: "Nora Al-Shammari", fullNameAr: "نورة الشمري", email: "nora@medicore.com", role: "lab_staff" },
  ]).returning();

  // New role seed users
  await db.insert(usersTable).values([
    { clinicId, username: "compliance", passwordHash: await hashPassword("comply123"), fullName: "Compliance Officer", fullNameAr: "ضابط الامتثال", email: "compliance@medicore.com", role: "compliance_officer" },
    { clinicId, username: "billing_mgr", passwordHash: await hashPassword("billing123"), fullName: "Billing Manager", fullNameAr: "مدير الفواتير", email: "billing@medicore.com", role: "billing_manager" },
    { clinicId, username: "pharmacist1", passwordHash: await hashPassword("pharma123"), fullName: "Pharmacist Al-Jabri", fullNameAr: "صيدلاني الجابري", email: "pharmacy@medicore.com", role: "pharmacist" },
  ]);

  console.log("Users created.");

  // Patients
  console.log("Creating patients...");
  const today = new Date();
  const [p1, p2, p3] = await db.insert(patientsTable).values([
    { clinicId, mrn: "MRN001001", idCardNumber: "1012345678", fullName: "Mohammed Al-Qahtani", fullNameAr: "محمد القحطاني", dateOfBirth: "1985-03-15", gender: "male", phone: "+966501112233", bloodType: "O+", address: "Riyadh, Saudi Arabia", allergies: "Penicillin" },
    { clinicId, mrn: "MRN001002", idCardNumber: "2023456789", fullName: "Hessa Al-Otaibi", fullNameAr: "حصة العتيبي", dateOfBirth: "1992-07-22", gender: "female", phone: "+966502223344", bloodType: "A-", address: "Jeddah, Saudi Arabia" },
    { clinicId, mrn: "MRN001003", idCardNumber: "1034567890", fullName: "Abdullah Al-Harbi", fullNameAr: "عبدالله الحربي", dateOfBirth: "1978-11-05", gender: "male", phone: "+966503334455", bloodType: "B+", address: "Dammam, Saudi Arabia", allergies: "Sulfa drugs" },
  ]).returning();
  console.log("Patients created.");

  // Appointments
  console.log("Creating appointments...");
  await db.insert(appointmentsTable).values([
    { clinicId, patientId: p1.id, doctorId: doctor1.id, scheduledAt: new Date(), reason: "General checkup", status: "checked_in" },
    { clinicId, patientId: p2.id, doctorId: doctor2.id, scheduledAt: new Date(Date.now() + 3600000), reason: "Follow-up visit", status: "scheduled" },
    { clinicId, patientId: p3.id, doctorId: doctor1.id, scheduledAt: new Date(Date.now() + 7200000), reason: "Chronic pain management", status: "scheduled" },
  ]);
  console.log("Appointments created.");

  // Inventory
  console.log("Creating inventory...");
  await db.insert(inventoryTable).values([
    { clinicId, name: "Paracetamol 500mg", category: "Medicine", quantity: 500, unit: "tablet", minimumStock: 100 },
    { clinicId, name: "Amoxicillin 250mg", category: "Medicine", quantity: 80, unit: "capsule", minimumStock: 100, expiryDate: "2026-12-31" },
    { clinicId, name: "Surgical Gloves (M)", category: "Supply", quantity: 200, unit: "pair", minimumStock: 50 },
    { clinicId, name: "Disposable Syringes 5ml", category: "Supply", quantity: 30, unit: "piece", minimumStock: 100 },
    { clinicId, name: "Blood Glucose Test Strips", category: "Lab Supply", quantity: 150, unit: "strip", minimumStock: 50, expiryDate: "2025-06-01" },
    { clinicId, name: "Bandages (elastic)", category: "Supply", quantity: 75, unit: "roll", minimumStock: 30 },
  ]);
  console.log("Inventory created.");

  // Notifications for the admin
  await db.insert(notificationsTable).values([
    { clinicId, userId: admin.id, title: "System Ready", message: "MediCore Clinic Management System is now active. All modules are operational.", type: "general" },
    { clinicId, userId: doctor1.id, title: "Welcome to MediCore", message: "Your account has been created. You have 3 appointments scheduled today.", type: "general" },
  ]);

  console.log("\n✅ Seed completed successfully with bcrypt password hashing!");
  console.log("\nLogin credentials:");
  console.log("  Super Admin: superadmin / admin123");
  console.log("  Admin:       admin / admin123");
  console.log("  Doctor 1:    dr_ahmed / doctor123");
  console.log("  Doctor 2:    dr_sara / doctor123");
  console.log("  Nurse:       nurse1 / nurse123");
  console.log("  Front Desk:  receptionist / front123");
  console.log("  X-Ray:       xray_tech / xray123");
  console.log("  Lab:         lab_tech / lab123");

  process.exit(0);
}

seed().catch(err => {
  console.error("Seed failed:", err);
  process.exit(1);
});
