import { db } from "@workspace/db";
import {
  usersTable, patientsTable, appointmentsTable, inventoryTable,
  notificationsTable
} from "@workspace/db";
import { createHmac, randomBytes } from "crypto";

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = createHmac("sha256", salt).update(password).digest("hex");
  return `${salt}:${hash}`;
}

async function seed() {
  console.log("Seeding database...");

  // Users
  const existingUsers = await db.select().from(usersTable);
  if (existingUsers.length === 0) {
    console.log("Creating users...");
    const [superAdmin, admin, doctor1, doctor2, nurse, frontDesk, xrayStaff, labStaff] = await db.insert(usersTable).values([
      { username: "superadmin", passwordHash: hashPassword("admin123"), fullName: "Super Administrator", fullNameAr: "مشرف عام", email: "superadmin@medicore.com", role: "super_admin" },
      { username: "admin", passwordHash: hashPassword("admin123"), fullName: "Admin User", fullNameAr: "مشرف", email: "admin@medicore.com", role: "admin" },
      { username: "dr_ahmed", passwordHash: hashPassword("doctor123"), fullName: "Dr. Ahmed Al-Rashidi", fullNameAr: "د. أحمد الراشدي", email: "ahmed@medicore.com", role: "doctor", phone: "+966501234567" },
      { username: "dr_sara", passwordHash: hashPassword("doctor123"), fullName: "Dr. Sara Al-Nasser", fullNameAr: "د. سارة الناصر", email: "sara@medicore.com", role: "doctor", phone: "+966502234567" },
      { username: "nurse1", passwordHash: hashPassword("nurse123"), fullName: "Fatima Al-Zahra", fullNameAr: "فاطمة الزهراء", email: "fatima@medicore.com", role: "nurse" },
      { username: "receptionist", passwordHash: hashPassword("front123"), fullName: "Omar Al-Farouk", fullNameAr: "عمر الفاروق", email: "omar@medicore.com", role: "front_desk" },
      { username: "xray_tech", passwordHash: hashPassword("xray123"), fullName: "Khalid Al-Mutairi", fullNameAr: "خالد المطيري", email: "khalid@medicore.com", role: "xray_staff" },
      { username: "lab_tech", passwordHash: hashPassword("lab123"), fullName: "Nora Al-Shammari", fullNameAr: "نورة الشمري", email: "nora@medicore.com", role: "lab_staff" },
    ]).returning();

    console.log("Users created.");

    // Patients
    console.log("Creating patients...");
    const today = new Date();
    const [p1, p2, p3] = await db.insert(patientsTable).values([
      { mrn: "MRN001001", fullName: "Mohammed Al-Qahtani", fullNameAr: "محمد القحطاني", dateOfBirth: "1985-03-15", gender: "male", phone: "+966501112233", bloodType: "O+", address: "Riyadh, Saudi Arabia", allergies: "Penicillin" },
      { mrn: "MRN001002", fullName: "Hessa Al-Otaibi", fullNameAr: "حصة العتيبي", dateOfBirth: "1992-07-22", gender: "female", phone: "+966502223344", bloodType: "A-", address: "Jeddah, Saudi Arabia" },
      { mrn: "MRN001003", fullName: "Abdullah Al-Harbi", fullNameAr: "عبدالله الحربي", dateOfBirth: "1978-11-05", gender: "male", phone: "+966503334455", bloodType: "B+", address: "Dammam, Saudi Arabia", allergies: "Sulfa drugs" },
    ]).returning();
    console.log("Patients created.");

    // Appointments
    console.log("Creating appointments...");
    await db.insert(appointmentsTable).values([
      { patientId: p1.id, doctorId: doctor1.id, scheduledAt: new Date(), reason: "General checkup", status: "checked_in" },
      { patientId: p2.id, doctorId: doctor2.id, scheduledAt: new Date(Date.now() + 3600000), reason: "Follow-up visit", status: "scheduled" },
      { patientId: p3.id, doctorId: doctor1.id, scheduledAt: new Date(Date.now() + 7200000), reason: "Chronic pain management", status: "scheduled" },
    ]);
    console.log("Appointments created.");

    // Inventory
    console.log("Creating inventory...");
    await db.insert(inventoryTable).values([
      { name: "Paracetamol 500mg", category: "Medicine", quantity: 500, unit: "tablet", minimumStock: 100 },
      { name: "Amoxicillin 250mg", category: "Medicine", quantity: 80, unit: "capsule", minimumStock: 100, expiryDate: "2026-12-31" },
      { name: "Surgical Gloves (M)", category: "Supply", quantity: 200, unit: "pair", minimumStock: 50 },
      { name: "Disposable Syringes 5ml", category: "Supply", quantity: 30, unit: "piece", minimumStock: 100 },
      { name: "Blood Glucose Test Strips", category: "Lab Supply", quantity: 150, unit: "strip", minimumStock: 50, expiryDate: "2025-06-01" },
      { name: "Bandages (elastic)", category: "Supply", quantity: 75, unit: "roll", minimumStock: 30 },
    ]);
    console.log("Inventory created.");

    // Notifications for the admin
    await db.insert(notificationsTable).values([
      { userId: admin.id, title: "System Ready", message: "MediCore Clinic Management System is now active. All modules are operational.", type: "general" },
      { userId: doctor1.id, title: "Welcome to MediCore", message: "Your account has been created. You have 3 appointments scheduled today.", type: "general" },
    ]);

    console.log("Seed completed successfully!");
    console.log("\nLogin credentials:");
    console.log("  Super Admin: superadmin / admin123");
    console.log("  Admin:       admin / admin123");
    console.log("  Doctor 1:    dr_ahmed / doctor123");
    console.log("  Doctor 2:    dr_sara / doctor123");
    console.log("  Nurse:       nurse1 / nurse123");
    console.log("  Front Desk:  receptionist / front123");
    console.log("  X-Ray:       xray_tech / xray123");
    console.log("  Lab:         lab_tech / lab123");
  } else {
    console.log("Database already seeded, skipping.");
  }

  process.exit(0);
}

seed().catch(err => {
  console.error("Seed failed:", err);
  process.exit(1);
});
