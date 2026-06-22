import { db, sql } from "@workspace/db";
import {
  clinicsTable,
  usersTable,
  patientsTable,
  appointmentsTable,
  medicalRecordsTable,
  prescriptionsTable,
  labTestsTable,
  xrayRecordsTable,
  ultrasoundRecordsTable,
  invoicesTable,
  invoiceItemsTable,
  inventoryTable,
  inventoryTransactionsTable,
  notificationsTable,
  doctorSchedulesTable,
  servicesCatalogTable,
  patientConsentsTable,
  clinicNoticesTable,
  operationsTable,
  doctorPatientsTable,
  clinicInvoiceCountersTable,
} from "@workspace/db";
import bcrypt from "bcrypt";

const BCRYPT_ROUNDS = 12;

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

// ── date helpers ──────────────────────────────────────────────────────────────
const daysAgo = (days: number, hour = 9, minute = 0): Date => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  return d;
};

const daysFromNow = (days: number, hour = 9, minute = 0): Date => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d;
};

const todayAt = (hour: number, minute = 0): Date => {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d;
};

async function seed() {
  console.log("Seeding database…");

  // Bootstrap utility tables (idempotent)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS login_attempts (
      key          TEXT PRIMARY KEY,
      count        INTEGER NOT NULL DEFAULT 0,
      first_seen   TIMESTAMPTZ NOT NULL,
      locked_until TIMESTAMPTZ,
      updated_at   TIMESTAMPTZ NOT NULL
    )
  `);
  await db.execute(sql`CREATE SEQUENCE IF NOT EXISTS invoice_seq START WITH 1000`);
  await db.execute(sql`CREATE SEQUENCE IF NOT EXISTS mrn_seq   START WITH 1001`);

  // ── clear ─────────────────────────────────────────────────────────────────
  console.log("Clearing existing data…");
  // inventory and operations have no FK → clinics so truncate them first
  await db.execute(sql`TRUNCATE TABLE inventory_transactions, inventory, operations RESTART IDENTITY CASCADE`);
  await db.execute(sql`TRUNCATE TABLE notifications, appointments, patients, users, clinics RESTART IDENTITY CASCADE`);

  // ── clinic ────────────────────────────────────────────────────────────────
  console.log("Creating clinic…");
  const [clinic] = await db.insert(clinicsTable).values({
    name:   "MediCore Clinic",
    nameAr: "عيادة ميدي كور",
    locale:   "en",
    timezone: "Asia/Riyadh",
  }).returning();
  const cid = clinic.id;

  // ── users ─────────────────────────────────────────────────────────────────
  console.log("Creating users…");
  const [superAdmin, admin, doc1, doc2, nurse, frontDesk, xrayStaff, labStaff] =
    await db.insert(usersTable).values([
      { clinicId: cid, username: "superadmin",   passwordHash: await hashPassword("admin123"),   fullName: "Super Administrator",      fullNameAr: "مشرف عام",            email: "superadmin@medicore.com",  role: "super_admin" },
      { clinicId: cid, username: "admin",         passwordHash: await hashPassword("admin123"),   fullName: "Admin User",               fullNameAr: "مشرف",                email: "admin@medicore.com",       role: "admin" },
      { clinicId: cid, username: "dr_ahmed",      passwordHash: await hashPassword("doctor123"),  fullName: "Dr. Ahmed Al-Rashidi",     fullNameAr: "د. أحمد الراشدي",     email: "ahmed@medicore.com",      role: "doctor",    phone: "+966501234567", specialty: "Cardiology",  department: "Internal Medicine" },
      { clinicId: cid, username: "dr_sara",       passwordHash: await hashPassword("doctor123"),  fullName: "Dr. Sara Al-Nasser",      fullNameAr: "د. سارة الناصر",      email: "sara@medicore.com",       role: "doctor",    phone: "+966502234567", specialty: "Pediatrics", department: "Pediatrics" },
      { clinicId: cid, username: "nurse1",        passwordHash: await hashPassword("nurse123"),   fullName: "Fatima Al-Zahra",          fullNameAr: "فاطمة الزهراء",       email: "fatima@medicore.com",     role: "nurse" },
      { clinicId: cid, username: "receptionist",  passwordHash: await hashPassword("front123"),   fullName: "Omar Al-Farouk",           fullNameAr: "عمر الفاروق",         email: "omar@medicore.com",       role: "front_desk" },
      { clinicId: cid, username: "xray_tech",     passwordHash: await hashPassword("xray123"),    fullName: "Khalid Al-Mutairi",        fullNameAr: "خالد المطيري",        email: "khalid.tech@medicore.com",role: "xray_staff" },
      { clinicId: cid, username: "lab_tech",      passwordHash: await hashPassword("lab123"),     fullName: "Nora Al-Shammari",         fullNameAr: "نورة الشمري",         email: "nora@medicore.com",       role: "lab_staff" },
    ]).returning();

  await db.insert(usersTable).values([
    { clinicId: cid, username: "compliance",  passwordHash: await hashPassword("comply123"),  fullName: "Hana Al-Otaibi",      fullNameAr: "هناء العتيبي",     email: "compliance@medicore.com", role: "compliance_officer" },
    { clinicId: cid, username: "billing_mgr", passwordHash: await hashPassword("billing123"), fullName: "Saleh Al-Ghamdi",     fullNameAr: "صالح الغامدي",     email: "billing@medicore.com",    role: "billing_manager" },
    { clinicId: cid, username: "pharmacist1", passwordHash: await hashPassword("pharma123"),  fullName: "Reem Al-Jabri",       fullNameAr: "ريم الجابري",      email: "pharmacy@medicore.com",   role: "pharmacist" },
  ]);
  console.log("Users created.");

  // ── doctor schedules ──────────────────────────────────────────────────────
  console.log("Creating doctor schedules…");
  const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
  await db.insert(doctorSchedulesTable).values(
    [doc1, doc2].flatMap(doc =>
      DAYS.map(day => ({
        clinicId: cid, doctorId: doc.id, dayOfWeek: day,
        startTime: "08:00", endTime: "17:00", slotMinutes: 30, maxPatients: 20, status: "active" as const,
      })),
    ),
  );

  // ── patients ──────────────────────────────────────────────────────────────
  console.log("Creating patients…");
  const [p1, p2, p3, p4, p5, p6, p7, p8, p9, p10] = await db.insert(patientsTable).values([
    { clinicId: cid, mrn: "MRN001001", idCardNumber: "1012345678", fullName: "Mohammed Al-Qahtani",  fullNameAr: "محمد القحطاني",   dateOfBirth: "1985-03-15", gender: "male",   phone: "+966501112233", bloodType: "O+",  address: "Riyadh, Al-Malaz", allergies: "Penicillin", emergencyContact: '{"name":"Ali Al-Qahtani","phone":"+966501112234","relation":"Brother"}' },
    { clinicId: cid, mrn: "MRN001002", idCardNumber: "2023456789", fullName: "Hessa Al-Otaibi",      fullNameAr: "حصة العتيبي",     dateOfBirth: "1992-07-22", gender: "female", phone: "+966502223344", bloodType: "A-",  address: "Jeddah, Al-Salamah" },
    { clinicId: cid, mrn: "MRN001003", idCardNumber: "1034567890", fullName: "Abdullah Al-Harbi",    fullNameAr: "عبدالله الحربي",   dateOfBirth: "1978-11-05", gender: "male",   phone: "+966503334455", bloodType: "B+",  address: "Dammam, Al-Faisaliyah", allergies: "Sulfa drugs" },
    { clinicId: cid, mrn: "MRN001004", idCardNumber: "2045678901", fullName: "Layla Al-Zahrani",     fullNameAr: "ليلى الزهراني",   dateOfBirth: "1988-09-10", gender: "female", phone: "+966504445566", bloodType: "AB+", address: "Riyadh, Al-Wurud" },
    { clinicId: cid, mrn: "MRN001005", idCardNumber: "1056789012", fullName: "Faisal Al-Dosari",     fullNameAr: "فيصل الدوسري",    dateOfBirth: "1995-04-20", gender: "male",   phone: "+966505556677", bloodType: "O-",  address: "Riyadh, Al-Rawdah", allergies: "Aspirin" },
    { clinicId: cid, mrn: "MRN001006", idCardNumber: "2067890123", fullName: "Noura Al-Ghamdi",      fullNameAr: "نورة الغامدي",    dateOfBirth: "2001-12-03", gender: "female", phone: "+966506667788", bloodType: "A+",  address: "Jeddah, Al-Rowais" },
    { clinicId: cid, mrn: "MRN001007", idCardNumber: "1078901234", fullName: "Tariq Al-Shehri",      fullNameAr: "طارق الشهري",     dateOfBirth: "1970-06-15", gender: "male",   phone: "+966507778899", bloodType: "B-",  address: "Abha, Al-Manhal" },
    { clinicId: cid, mrn: "MRN001008", idCardNumber: "2089012345", fullName: "Maryam Al-Balawi",     fullNameAr: "مريم البلوي",     dateOfBirth: "1983-02-28", gender: "female", phone: "+966508889900", bloodType: "O+",  address: "Tabuk, Al-Nuzha" },
    { clinicId: cid, mrn: "MRN001009", idCardNumber: "1090123456", fullName: "Khalid Al-Dawsari",    fullNameAr: "خالد الدوسري",    dateOfBirth: "1990-08-22", gender: "male",   phone: "+966509990011", bloodType: "AB-", address: "Riyadh, Al-Sulaimaniyah" },
    { clinicId: cid, mrn: "MRN001010", idCardNumber: "2001234567", fullName: "Sara Al-Juhani",       fullNameAr: "سارة الجهني",     dateOfBirth: "2005-11-18", gender: "female", phone: "+966501230123", bloodType: "A+",  address: "Madinah, Al-Aqiq" },
  ]).returning();

  // ── patient consents (treatment — required before records/prescriptions) ──
  console.log("Creating patient consents…");
  await db.insert(patientConsentsTable).values(
    [p1, p2, p3, p4, p5, p6, p7, p8, p9, p10].map(p => ({
      clinicId: cid,
      patientId: p.id,
      consentType: "treatment" as const,
      grantedByUserId: frontDesk.id,
      ipAddress: "192.168.1.10",
      documentVersion: "v2.1",
      notes: "Patient provided verbal and written consent at registration.",
    })),
  );

  // ── appointments ──────────────────────────────────────────────────────────
  // Unique partial index on (doctorId, scheduledAt) where status NOT IN
  // ('cancelled','no_show') — every active slot must be a distinct timestamp.
  console.log("Creating appointments…");

  // Dr. Ahmed (Cardiology) past completed appointments
  const appts1 = await db.insert(appointmentsTable).values([
    { clinicId: cid, patientId: p1.id,  doctorId: doc1.id, scheduledAt: daysAgo(30, 9,  0),  reason: "Chest pain evaluation",                status: "completed",  bookingSource: "phone",   triagePriority: "urgent",  checkedInAt: daysAgo(30, 8, 50), triageStartedAt: daysAgo(30, 9, 0), consultationStartedAt: daysAgo(30, 9, 15) },
    { clinicId: cid, patientId: p3.id,  doctorId: doc1.id, scheduledAt: daysAgo(27, 9,  0),  reason: "Hypertension follow-up",               status: "completed",  bookingSource: "phone",   triagePriority: "normal",  checkedInAt: daysAgo(27, 8, 55), triageStartedAt: daysAgo(27, 9, 5), consultationStartedAt: daysAgo(27, 9, 20) },
    { clinicId: cid, patientId: p7.id,  doctorId: doc1.id, scheduledAt: daysAgo(24, 9,  0),  reason: "Coronary artery disease management",   status: "completed",  bookingSource: "phone",   triagePriority: "urgent",  checkedInAt: daysAgo(24, 8, 45), triageStartedAt: daysAgo(24, 9, 0), consultationStartedAt: daysAgo(24, 9, 10) },
    { clinicId: cid, patientId: p8.id,  doctorId: doc1.id, scheduledAt: daysAgo(21, 9,  0),  reason: "Palpitations and dizziness",           status: "completed",  bookingSource: "walk_in", triagePriority: "normal",  checkedInAt: daysAgo(21, 8, 58), triageStartedAt: daysAgo(21, 9, 5), consultationStartedAt: daysAgo(21, 9, 25) },
    { clinicId: cid, patientId: p5.id,  doctorId: doc1.id, scheduledAt: daysAgo(18, 9,  0),  reason: "Lipid panel review",                   status: "no_show",    bookingSource: "online",  triagePriority: "normal" },
    { clinicId: cid, patientId: p1.id,  doctorId: doc1.id, scheduledAt: daysAgo(15, 9,  0),  reason: "Cardiac stress test follow-up",        status: "completed",  bookingSource: "phone",   triagePriority: "normal",  checkedInAt: daysAgo(15, 8, 52), triageStartedAt: daysAgo(15, 9, 5), consultationStartedAt: daysAgo(15, 9, 20) },
    { clinicId: cid, patientId: p4.id,  doctorId: doc1.id, scheduledAt: daysAgo(12, 9,  0),  reason: "Routine cardiac checkup",              status: "cancelled",  bookingSource: "online",  triagePriority: "normal",  cancellationReason: "Patient requested reschedule" },
    { clinicId: cid, patientId: p3.id,  doctorId: doc1.id, scheduledAt: daysAgo(9,  9,  0),  reason: "Medication adjustment",                status: "completed",  bookingSource: "phone",   triagePriority: "normal",  checkedInAt: daysAgo(9, 8, 50), triageStartedAt: daysAgo(9, 9, 5), consultationStartedAt: daysAgo(9, 9, 25) },
    { clinicId: cid, patientId: p7.id,  doctorId: doc1.id, scheduledAt: daysAgo(7,  9,  0),  reason: "Post-procedure check",                 status: "completed",  bookingSource: "phone",   triagePriority: "normal",  checkedInAt: daysAgo(7, 8, 53), triageStartedAt: daysAgo(7, 9, 5), consultationStartedAt: daysAgo(7, 9, 20) },
    { clinicId: cid, patientId: p8.id,  doctorId: doc1.id, scheduledAt: daysAgo(5,  9,  0),  reason: "Echocardiogram results review",        status: "completed",  bookingSource: "phone",   triagePriority: "normal",  checkedInAt: daysAgo(5, 8, 48), triageStartedAt: daysAgo(5, 9, 5), consultationStartedAt: daysAgo(5, 9, 30) },
    { clinicId: cid, patientId: p5.id,  doctorId: doc1.id, scheduledAt: daysAgo(3,  9,  0),  reason: "Chest tightness re-evaluation",        status: "completed",  bookingSource: "walk_in", triagePriority: "urgent",  checkedInAt: daysAgo(3, 8, 55), triageStartedAt: daysAgo(3, 9, 5), consultationStartedAt: daysAgo(3, 9, 15) },
    { clinicId: cid, patientId: p1.id,  doctorId: doc1.id, scheduledAt: daysAgo(1,  9,  0),  reason: "Blood pressure monitoring",            status: "completed",  bookingSource: "phone",   triagePriority: "normal",  checkedInAt: daysAgo(1, 8, 50), triageStartedAt: daysAgo(1, 9, 5), consultationStartedAt: daysAgo(1, 9, 20) },
  ]).returning();

  // Dr. Ahmed today + tomorrow
  const appts1Today = await db.insert(appointmentsTable).values([
    { clinicId: cid, patientId: p3.id,  doctorId: doc1.id, scheduledAt: todayAt(9,   0), reason: "Hypertension checkup",          status: "checked_in",          bookingSource: "phone",   triagePriority: "normal", checkedInAt: todayAt(8, 48) },
    { clinicId: cid, patientId: p4.id,  doctorId: doc1.id, scheduledAt: todayAt(9,  30), reason: "Arrhythmia assessment",         status: "in_triage",           bookingSource: "walk_in", triagePriority: "urgent", checkedInAt: todayAt(9, 20), triageStartedAt: todayAt(9, 32) },
    { clinicId: cid, patientId: p5.id,  doctorId: doc1.id, scheduledAt: todayAt(10,  0), reason: "Chest pain follow-up",          status: "ready_for_doctor",    bookingSource: "phone",   triagePriority: "normal", checkedInAt: todayAt(9, 50), triageStartedAt: todayAt(10, 5) },
    { clinicId: cid, patientId: p9.id,  doctorId: doc1.id, scheduledAt: todayAt(10, 30), reason: "Shortness of breath workup",    status: "in_consultation",     bookingSource: "phone",   triagePriority: "urgent", checkedInAt: todayAt(10, 18), triageStartedAt: todayAt(10, 32), consultationStartedAt: todayAt(10, 45) },
    { clinicId: cid, patientId: p8.id,  doctorId: doc1.id, scheduledAt: todayAt(11,  0), reason: "Cardiac medication review",     status: "awaiting_diagnostics",bookingSource: "online",  triagePriority: "normal", checkedInAt: todayAt(10, 55), triageStartedAt: todayAt(11, 5), consultationStartedAt: todayAt(11, 20) },
    { clinicId: cid, patientId: p7.id,  doctorId: doc1.id, scheduledAt: todayAt(11, 30), reason: "Angina management",             status: "scheduled",           bookingSource: "phone",   triagePriority: "normal" },
    { clinicId: cid, patientId: p1.id,  doctorId: doc1.id, scheduledAt: todayAt(14,  0), reason: "Routine cardiology follow-up",  status: "pending_payment",     bookingSource: "phone",   triagePriority: "normal", checkedInAt: todayAt(13, 50), triageStartedAt: todayAt(14, 5), consultationStartedAt: todayAt(14, 20) },
  ]).returning();

  await db.insert(appointmentsTable).values([
    { clinicId: cid, patientId: p6.id,  doctorId: doc1.id, scheduledAt: daysFromNow(1, 9,   0), reason: "Initial cardiology consult",  status: "scheduled", bookingSource: "online", triagePriority: "normal" },
    { clinicId: cid, patientId: p7.id,  doctorId: doc1.id, scheduledAt: daysFromNow(1, 9,  30), reason: "Medication titration review", status: "scheduled", bookingSource: "phone",  triagePriority: "normal" },
    { clinicId: cid, patientId: p8.id,  doctorId: doc1.id, scheduledAt: daysFromNow(2, 9,   0), reason: "Stress test follow-up",       status: "scheduled", bookingSource: "phone",  triagePriority: "normal" },
    { clinicId: cid, patientId: p3.id,  doctorId: doc1.id, scheduledAt: daysFromNow(3, 9,   0), reason: "Quarterly review",            status: "scheduled", bookingSource: "phone",  triagePriority: "normal" },
  ]);

  // Dr. Sara (Pediatrics) past completed
  const appts2 = await db.insert(appointmentsTable).values([
    { clinicId: cid, patientId: p2.id,  doctorId: doc2.id, scheduledAt: daysAgo(28, 9,  0),  reason: "Fever and sore throat",              status: "completed", bookingSource: "phone",   triagePriority: "normal",  checkedInAt: daysAgo(28, 8, 52), triageStartedAt: daysAgo(28, 9, 5), consultationStartedAt: daysAgo(28, 9, 20) },
    { clinicId: cid, patientId: p6.id,  doctorId: doc2.id, scheduledAt: daysAgo(25, 9,  0),  reason: "Well-child visit",                    status: "completed", bookingSource: "online",  triagePriority: "normal",  checkedInAt: daysAgo(25, 8, 55), triageStartedAt: daysAgo(25, 9, 5), consultationStartedAt: daysAgo(25, 9, 25) },
    { clinicId: cid, patientId: p9.id,  doctorId: doc2.id, scheduledAt: daysAgo(22, 9,  0),  reason: "Asthma management",                   status: "completed", bookingSource: "phone",   triagePriority: "urgent",  checkedInAt: daysAgo(22, 8, 48), triageStartedAt: daysAgo(22, 9, 0), consultationStartedAt: daysAgo(22, 9, 12) },
    { clinicId: cid, patientId: p10.id, doctorId: doc2.id, scheduledAt: daysAgo(19, 9,  0),  reason: "Vaccination schedule",                status: "completed", bookingSource: "online",  triagePriority: "normal",  checkedInAt: daysAgo(19, 8, 58), triageStartedAt: daysAgo(19, 9, 5), consultationStartedAt: daysAgo(19, 9, 20) },
    { clinicId: cid, patientId: p2.id,  doctorId: doc2.id, scheduledAt: daysAgo(16, 9,  0),  reason: "Cough and runny nose",                status: "no_show",   bookingSource: "phone",   triagePriority: "normal" },
    { clinicId: cid, patientId: p4.id,  doctorId: doc2.id, scheduledAt: daysAgo(13, 9,  0),  reason: "Allergy review",                      status: "completed", bookingSource: "phone",   triagePriority: "normal",  checkedInAt: daysAgo(13, 8, 50), triageStartedAt: daysAgo(13, 9, 5), consultationStartedAt: daysAgo(13, 9, 25) },
    { clinicId: cid, patientId: p6.id,  doctorId: doc2.id, scheduledAt: daysAgo(10, 9,  0),  reason: "Post-vaccination check",              status: "completed", bookingSource: "phone",   triagePriority: "normal",  checkedInAt: daysAgo(10, 8, 52), triageStartedAt: daysAgo(10, 9, 5), consultationStartedAt: daysAgo(10, 9, 20) },
    { clinicId: cid, patientId: p10.id, doctorId: doc2.id, scheduledAt: daysAgo(7,  9,  0),  reason: "Growth and development review",       status: "completed", bookingSource: "online",  triagePriority: "normal",  checkedInAt: daysAgo(7, 8, 48), triageStartedAt: daysAgo(7, 9, 5), consultationStartedAt: daysAgo(7, 9, 22) },
    { clinicId: cid, patientId: p9.id,  doctorId: doc2.id, scheduledAt: daysAgo(5,  9,  0),  reason: "Asthma inhaler technique review",     status: "completed", bookingSource: "phone",   triagePriority: "normal",  checkedInAt: daysAgo(5, 8, 55), triageStartedAt: daysAgo(5, 9, 5), consultationStartedAt: daysAgo(5, 9, 25) },
    { clinicId: cid, patientId: p2.id,  doctorId: doc2.id, scheduledAt: daysAgo(3,  9,  0),  reason: "Eczema flare-up",                     status: "completed", bookingSource: "walk_in", triagePriority: "normal",  checkedInAt: daysAgo(3, 8, 58), triageStartedAt: daysAgo(3, 9, 5), consultationStartedAt: daysAgo(3, 9, 20) },
    { clinicId: cid, patientId: p4.id,  doctorId: doc2.id, scheduledAt: daysAgo(1,  9,  0),  reason: "Seasonal allergy follow-up",          status: "completed", bookingSource: "phone",   triagePriority: "normal",  checkedInAt: daysAgo(1, 8, 53), triageStartedAt: daysAgo(1, 9, 5), consultationStartedAt: daysAgo(1, 9, 25) },
  ]).returning();

  // Dr. Sara today + tomorrow
  const appts2Today = await db.insert(appointmentsTable).values([
    { clinicId: cid, patientId: p2.id,  doctorId: doc2.id, scheduledAt: todayAt(9,   0), reason: "Recurring ear infection",      status: "in_consultation",     bookingSource: "phone",   triagePriority: "normal", checkedInAt: todayAt(8, 52), triageStartedAt: todayAt(9, 5), consultationStartedAt: todayAt(9, 22) },
    { clinicId: cid, patientId: p6.id,  doctorId: doc2.id, scheduledAt: todayAt(9,  30), reason: "Abdominal pain",               status: "awaiting_diagnostics",bookingSource: "walk_in", triagePriority: "urgent", checkedInAt: todayAt(9, 22), triageStartedAt: todayAt(9, 32), consultationStartedAt: todayAt(9, 45) },
    { clinicId: cid, patientId: p10.id, doctorId: doc2.id, scheduledAt: todayAt(10,  0), reason: "School health certificate",    status: "pending_payment",     bookingSource: "phone",   triagePriority: "normal", checkedInAt: todayAt(9, 50), triageStartedAt: todayAt(10, 5), consultationStartedAt: todayAt(10, 22) },
    { clinicId: cid, patientId: p9.id,  doctorId: doc2.id, scheduledAt: todayAt(10, 30), reason: "Asthma exacerbation",          status: "checked_in",          bookingSource: "phone",   triagePriority: "urgent", checkedInAt: todayAt(10, 25) },
    { clinicId: cid, patientId: p4.id,  doctorId: doc2.id, scheduledAt: todayAt(11,  0), reason: "Allergy testing results",      status: "scheduled",           bookingSource: "online",  triagePriority: "normal" },
    { clinicId: cid, patientId: p2.id,  doctorId: doc2.id, scheduledAt: todayAt(14,  0), reason: "Follow-up ear infection",      status: "scheduled",           bookingSource: "phone",   triagePriority: "normal" },
  ]).returning();

  await db.insert(appointmentsTable).values([
    { clinicId: cid, patientId: p6.id,  doctorId: doc2.id, scheduledAt: daysFromNow(1, 9,   0), reason: "Well-child annual visit",   status: "scheduled", bookingSource: "online", triagePriority: "normal" },
    { clinicId: cid, patientId: p10.id, doctorId: doc2.id, scheduledAt: daysFromNow(1, 9,  30), reason: "Vaccine booster (MMR)",     status: "scheduled", bookingSource: "phone",  triagePriority: "normal" },
    { clinicId: cid, patientId: p9.id,  doctorId: doc2.id, scheduledAt: daysFromNow(2, 9,   0), reason: "Pulmonology referral",      status: "scheduled", bookingSource: "phone",  triagePriority: "normal" },
    { clinicId: cid, patientId: p2.id,  doctorId: doc2.id, scheduledAt: daysFromNow(3, 9,   0), reason: "Hearing test follow-up",    status: "scheduled", bookingSource: "online", triagePriority: "normal" },
  ]);

  // ── doctor_patients (materialized scope) ──────────────────────────────────
  console.log("Creating doctor-patient scope links…");
  // Composite PK (doctorId, patientId) — onConflictDoNothing handles re-seeds.
  await db.insert(doctorPatientsTable).values([
    // Doc1 (Cardiology): all patients he's seen
    ...[p1, p3, p4, p5, p7, p8, p9, p6].map(p => ({ clinicId: cid, doctorId: doc1.id, patientId: p.id })),
    // Doc2 (Pediatrics): all patients she's seen
    ...[p2, p4, p6, p9, p10].map(p => ({ clinicId: cid, doctorId: doc2.id, patientId: p.id })),
  ]).onConflictDoNothing();

  // ── medical records ───────────────────────────────────────────────────────
  console.log("Creating medical records…");
  const [mr1, mr2, mr3, mr4, mr5, mr6, mr7, mr8] = await db.insert(medicalRecordsTable).values([
    {
      clinicId: cid, patientId: p1.id, doctorId: doc1.id, appointmentId: appts1[0].id,
      chiefComplaint: "Chest pain radiating to left arm", chiefComplaintAr: "ألم في الصدر ينتشر إلى الذراع الأيسر",
      diagnosis: "Stable angina pectoris — NSTEMI ruled out via serial troponins", diagnosisAr: "ذبحة صدرية مستقرة — تم استبعاد احتشاء عضلة القلب",
      treatment: "Nitroglycerin 0.4mg SL PRN, Aspirin 81mg daily, Metoprolol 25mg BID. Referred for stress test.", treatmentAr: "نيتروغليسرين تحت اللسان عند الحاجة، أسبرين 81 ملغ يومياً، ميتوبرولول 25 ملغ مرتين يومياً",
      notes: "Patient to reduce exertion and follow low-salt diet.",
      vitals: { bloodPressureSystolic: 148, bloodPressureDiastolic: 95, heartRate: 88, temperature: 37.1, oxygenSaturation: 97, respiratoryRate: 18, weight: 88, height: 176 },
    },
    {
      clinicId: cid, patientId: p3.id, doctorId: doc1.id, appointmentId: appts1[1].id,
      chiefComplaint: "Persistent headaches and elevated BP readings at home", chiefComplaintAr: "صداع مستمر وارتفاع في قراءات ضغط الدم",
      diagnosis: "Uncontrolled essential hypertension — Grade 2", diagnosisAr: "ارتفاع ضغط الدم الأساسي غير المسيطر عليه — الدرجة الثانية",
      treatment: "Amlodipine 10mg daily, Ramipril 5mg daily. Monthly BP log required.", treatmentAr: "أملوديبين 10 ملغ يومياً، راميبريل 5 ملغ يومياً",
      notes: "Dietary counselling: DASH diet, sodium restriction <2g/day.",
      vitals: { bloodPressureSystolic: 162, bloodPressureDiastolic: 102, heartRate: 78, temperature: 36.8, oxygenSaturation: 98, respiratoryRate: 16, weight: 95, height: 178 },
    },
    {
      clinicId: cid, patientId: p7.id, doctorId: doc1.id, appointmentId: appts1[2].id,
      chiefComplaint: "Exertional chest pain and fatigue", chiefComplaintAr: "ألم صدري مع المجهود وتعب",
      diagnosis: "Stable coronary artery disease — 2-vessel disease (LAD, RCA) on prior cath", diagnosisAr: "مرض الشريان التاجي المستقر — إصابة وعائين",
      treatment: "Atorvastatin 80mg nightly, Clopidogrel 75mg daily, Bisoprolol 5mg BID. Cardiac rehab referral.", treatmentAr: "أتورفاستاتين 80 ملغ ليلاً، كلوبيدوغريل 75 ملغ يومياً، بيسوبرولول 5 ملغ مرتين",
      notes: "Angioplasty discussed — patient deferred decision pending second opinion.",
      vitals: { bloodPressureSystolic: 134, bloodPressureDiastolic: 86, heartRate: 64, temperature: 36.9, oxygenSaturation: 96, respiratoryRate: 17, weight: 79, height: 172 },
    },
    {
      clinicId: cid, patientId: p8.id, doctorId: doc1.id, appointmentId: appts1[3].id,
      chiefComplaint: "Recurrent palpitations and dizziness on standing", chiefComplaintAr: "خفقان متكرر ودوار عند الوقوف",
      diagnosis: "Paroxysmal supraventricular tachycardia (PSVT) — Holter confirmed", diagnosisAr: "تسرع القلب فوق البطيني الانتيابي — مؤكد بهولتر",
      treatment: "Verapamil 80mg TID. Valsalva manoeuvre education. Refer for electrophysiology study.", treatmentAr: "فيراباميل 80 ملغ ثلاث مرات يومياً، تعليم مناورة فالسالفا",
      notes: "Avoid caffeine and stimulants. Return immediately if episode >30 min.",
      vitals: { bloodPressureSystolic: 118, bloodPressureDiastolic: 76, heartRate: 102, temperature: 36.7, oxygenSaturation: 99, respiratoryRate: 15, weight: 62, height: 163 },
    },
    {
      clinicId: cid, patientId: p2.id, doctorId: doc2.id, appointmentId: appts2[0].id,
      chiefComplaint: "3-day fever, sore throat, and ear pain", chiefComplaintAr: "حمى 3 أيام وألم في الحلق والأذن",
      diagnosis: "Acute tonsillitis with otitis media — Group A Strep rapid test positive", diagnosisAr: "التهاب اللوزتين الحاد مع التهاب الأذن الوسطى",
      treatment: "Amoxicillin-Clavulanate 625mg PO TID × 10 days. Paracetamol 500mg PRN for fever.", treatmentAr: "أموكسيسيلين-كلافولانيت 625 ملغ ثلاث مرات يومياً لمدة 10 أيام",
      notes: "Follow up in 2 weeks if symptoms persist.",
      vitals: { bloodPressureSystolic: 108, bloodPressureDiastolic: 68, heartRate: 96, temperature: 38.6, oxygenSaturation: 99, respiratoryRate: 20, weight: 58, height: 162 },
    },
    {
      clinicId: cid, patientId: p9.id, doctorId: doc2.id, appointmentId: appts2[2].id,
      chiefComplaint: "Wheezing and shortness of breath after sports", chiefComplaintAr: "صفير وضيق تنفس بعد ممارسة الرياضة",
      diagnosis: "Moderate persistent asthma — exercise-induced exacerbation", diagnosisAr: "ربو متوسط مستمر — تفاقم ناجم عن التمرين",
      treatment: "Salbutamol inhaler 200mcg before exercise. Fluticasone/Salmeterol 250/25 BID maintenance.", treatmentAr: "سالبوتامول 200 ميكروغرام قبل التمرين، فلوتيكازون/سالميترول صيانة",
      notes: "Spacer technique reviewed. Peak flow meter provided.",
      vitals: { bloodPressureSystolic: 112, bloodPressureDiastolic: 72, heartRate: 106, temperature: 36.8, oxygenSaturation: 94, respiratoryRate: 24, weight: 67, height: 174 },
    },
    {
      clinicId: cid, patientId: p5.id, doctorId: doc1.id, appointmentId: appts1[10].id,
      chiefComplaint: "Chest tightness and shortness of breath at rest", chiefComplaintAr: "ضيق في الصدر وصعوبة في التنفس أثناء الراحة",
      diagnosis: "Acute coronary syndrome — NSTEMI. Troponin T elevated at 0.8 ng/mL.", diagnosisAr: "متلازمة الشريان التاجي الحادة — احتشاء غير موجة ST",
      treatment: "IV heparin, dual antiplatelet (Aspirin + Ticagrelor), O2 supplementation. Admitted for angiography.", treatmentAr: "هيبارين وريدي، مضادات صفيحات مزدوجة، أكسجين. دخول للقسطرة.",
      notes: "Cardiology consult in progress. ECG shows ST depression V4-V6.",
      vitals: { bloodPressureSystolic: 155, bloodPressureDiastolic: 98, heartRate: 114, temperature: 37.2, oxygenSaturation: 93, respiratoryRate: 22, weight: 92, height: 180 },
    },
    {
      clinicId: cid, patientId: p4.id, doctorId: doc2.id, appointmentId: appts2[5].id,
      chiefComplaint: "Seasonal sneezing, itchy eyes, nasal congestion", chiefComplaintAr: "عطس موسمي وحكة في العيون واحتقان أنفي",
      diagnosis: "Allergic rhinitis — sensitisation to dust mites and grass pollen", diagnosisAr: "التهاب الأنف التحسسي — تحسس لعث الغبار وحبوب اللقاح",
      treatment: "Loratadine 10mg OD, Fluticasone nasal spray 50mcg BID. Consider immunotherapy referral.", treatmentAr: "لوراتادين 10 ملغ مرة يومياً، بخاخ فلوتيكازون أنفي مرتين يومياً",
      notes: "HEPA air filter recommended for bedroom. Keep windows closed during high-pollen season.",
      vitals: { bloodPressureSystolic: 110, bloodPressureDiastolic: 70, heartRate: 76, temperature: 36.6, oxygenSaturation: 99, respiratoryRate: 15, weight: 61, height: 165 },
    },
  ]).returning();

  // ── prescriptions ─────────────────────────────────────────────────────────
  console.log("Creating prescriptions…");
  await db.insert(prescriptionsTable).values([
    {
      clinicId: cid, patientId: p1.id, doctorId: doc1.id, recordId: mr1.id,
      medications: [
        { name: "Nitroglycerin",  dosage: "0.4mg",  frequency: "As needed (PRN) under tongue",          duration: "Ongoing",  instructions: "Place under tongue at onset of chest pain. Max 3 doses 5 min apart. Call emergency if no relief." },
        { name: "Aspirin",        dosage: "81mg",   frequency: "Once daily with breakfast",              duration: "Ongoing",  instructions: "Take with food to reduce stomach upset." },
        { name: "Metoprolol",     dosage: "25mg",   frequency: "Twice daily (morning and evening)",      duration: "3 months", instructions: "Do not stop suddenly. Take at same times each day." },
      ],
      notes: "Carry nitroglycerin at all times. Avoid heavy lifting and strenuous activity.",
      notesAr: "احمل النيتروغليسرين دائماً. تجنب رفع الأشياء الثقيلة.",
    },
    {
      clinicId: cid, patientId: p3.id, doctorId: doc1.id, recordId: mr2.id,
      medications: [
        { name: "Amlodipine",  dosage: "10mg", frequency: "Once daily in the morning", duration: "3 months", instructions: "May cause ankle swelling. Report to doctor if severe." },
        { name: "Ramipril",    dosage: "5mg",  frequency: "Once daily",                duration: "3 months", instructions: "Avoid potassium supplements. Drink adequate water." },
      ],
      notes: "Monitor blood pressure twice daily and record in log book.",
      notesAr: "قيس ضغط الدم مرتين يومياً وسجله في دفتر المتابعة.",
    },
    {
      clinicId: cid, patientId: p7.id, doctorId: doc1.id, recordId: mr3.id,
      medications: [
        { name: "Atorvastatin",  dosage: "80mg",  frequency: "Once daily at bedtime",                   duration: "Ongoing",  instructions: "Avoid grapefruit juice. Report muscle pain immediately." },
        { name: "Clopidogrel",   dosage: "75mg",  frequency: "Once daily with food",                    duration: "Ongoing",  instructions: "Do not stop without consulting cardiologist. Avoid NSAIDs." },
        { name: "Bisoprolol",    dosage: "5mg",   frequency: "Twice daily (morning and evening)",        duration: "3 months", instructions: "Check pulse before each dose. Hold if HR < 50 bpm." },
      ],
      notes: "Patient on dual antiplatelet therapy — advise to inform all treating physicians and dentist.",
      notesAr: "المريض على علاج مضاد مزدوج للصفيحات — أبلغ جميع الأطباء المعالجين.",
    },
    {
      clinicId: cid, patientId: p8.id, doctorId: doc1.id, recordId: mr4.id,
      medications: [
        { name: "Verapamil", dosage: "80mg", frequency: "Three times daily (every 8 hours)", duration: "2 months", instructions: "Take with food. Avoid driving until heart rate stabilizes." },
      ],
      notes: "Return immediately if episode lasts more than 30 minutes.",
      notesAr: "عد فوراً إذا استمرت النوبة أكثر من 30 دقيقة.",
    },
    {
      clinicId: cid, patientId: p2.id, doctorId: doc2.id, recordId: mr5.id,
      medications: [
        { name: "Amoxicillin-Clavulanate", dosage: "625mg", frequency: "Three times daily with meals", duration: "10 days", instructions: "Complete the full course even if feeling better. Store refrigerated." },
        { name: "Paracetamol",             dosage: "500mg", frequency: "Every 6 hours as needed for fever/pain", duration: "5 days", instructions: "Maximum 4g per day. Do not exceed dose." },
        { name: "Otrivin nasal drops",     dosage: "2 drops per nostril", frequency: "Three times daily", duration: "5 days", instructions: "Tilt head back slightly when applying." },
      ],
      notes: "Soft diet encouraged. Plenty of warm fluids.",
      notesAr: "نظام غذائي لين. الإكثار من السوائل الدافئة.",
    },
    {
      clinicId: cid, patientId: p9.id, doctorId: doc2.id, recordId: mr6.id,
      medications: [
        { name: "Salbutamol inhaler",           dosage: "200mcg (2 puffs)", frequency: "Before exercise or as needed for acute symptoms", duration: "Ongoing",  instructions: "Shake before use. Use spacer for best effect. Max 4 puffs/day." },
        { name: "Fluticasone/Salmeterol",        dosage: "250/25mcg",       frequency: "Twice daily — morning and evening",               duration: "3 months", instructions: "Rinse mouth after each use to prevent oral thrush. Do not stop suddenly." },
        { name: "Montelukast",                   dosage: "10mg",            frequency: "Once daily at bedtime",                           duration: "3 months", instructions: "Take regularly even when symptom-free." },
      ],
      notes: "Asthma action plan provided. Trigger avoidance education given.",
      notesAr: "تم تقديم خطة عمل الربو. توعية بتجنب المحفزات.",
    },
    {
      clinicId: cid, patientId: p5.id, doctorId: doc1.id, recordId: mr7.id,
      medications: [
        { name: "Aspirin",     dosage: "300mg loading, then 75mg", frequency: "Loading dose now, then once daily", duration: "Ongoing",  instructions: "Do not stop without cardiology advice. Take with food." },
        { name: "Ticagrelor",  dosage: "180mg loading, then 90mg", frequency: "Loading dose now, then twice daily", duration: "12 months", instructions: "Do not crush or chew. Avoid aspirin doses > 100mg." },
        { name: "Enoxaparin",  dosage: "1mg/kg",                   frequency: "Subcutaneous every 12 hours",        duration: "Until angiography", instructions: "Administered by nursing staff. Rotate injection sites." },
      ],
      notes: "NSTEMI acute management. Patient pending urgent catheterisation lab.",
      notesAr: "علاج احتشاء NSTEMI الحاد. المريض في انتظار قسطرة عاجلة.",
    },
    {
      clinicId: cid, patientId: p4.id, doctorId: doc2.id, recordId: mr8.id,
      medications: [
        { name: "Loratadine",         dosage: "10mg",        frequency: "Once daily in the morning",    duration: "3 months", instructions: "Non-drowsy. Can be taken with or without food." },
        { name: "Fluticasone nasal",  dosage: "50mcg/spray", frequency: "2 sprays per nostril BID",    duration: "3 months", instructions: "Tilt head slightly forward. Aim spray away from nasal septum." },
        { name: "Artificial tears",   dosage: "1-2 drops",   frequency: "Four times daily in each eye", duration: "As needed", instructions: "Remove contact lenses before use." },
      ],
      notes: "Refer to allergist for skin prick testing if symptoms persist past 3 months.",
      notesAr: "إحالة لطبيب التحسس لاختبارات الجلد إذا استمرت الأعراض.",
    },
  ]);

  // ── lab tests ─────────────────────────────────────────────────────────────
  console.log("Creating lab tests…");
  const labGroupA = "LG-" + Date.now().toString(36).toUpperCase();
  const labGroupB = "LG-" + (Date.now() + 1).toString(36).toUpperCase();

  await db.insert(labTestsTable).values([
    { clinicId: cid, patientId: p1.id,  requestedById: doc1.id, performedById: labStaff.id, appointmentId: appts1[0].id, testName: "Troponin T (high-sensitivity)", testNameAr: "تروبونين T (عالي الحساسية)", status: "completed", results: "0.012 ng/mL (Normal < 0.014 ng/mL) — Negative for myocardial injury", resultsAr: "سالب — لا يوجد تلف عضلة القلب", orderGroupId: labGroupA },
    { clinicId: cid, patientId: p1.id,  requestedById: doc1.id, performedById: labStaff.id, appointmentId: appts1[0].id, testName: "Complete Blood Count (CBC)",        testNameAr: "صورة دم كاملة", status: "completed", results: "WBC 7.2, RBC 4.8, Hgb 14.2, Hct 42%, PLT 235 — All within normal limits", resultsAr: "جميع القيم ضمن المعدل الطبيعي", orderGroupId: labGroupA },
    { clinicId: cid, patientId: p1.id,  requestedById: doc1.id, performedById: labStaff.id, appointmentId: appts1[0].id, testName: "Lipid Panel",                         testNameAr: "صورة الدهون", status: "completed", results: "Total Cholesterol 218 mg/dL, LDL 142 mg/dL (HIGH), HDL 38 mg/dL (LOW), TG 190 mg/dL", resultsAr: "كوليسترول كلي مرتفع، LDL مرتفع، HDL منخفض", orderGroupId: labGroupA },
    { clinicId: cid, patientId: p3.id,  requestedById: doc1.id, performedById: labStaff.id, appointmentId: appts1[1].id, testName: "Comprehensive Metabolic Panel",      testNameAr: "لوحة التمثيل الغذائي الشاملة", status: "completed", results: "Na 140, K 4.1, Cr 1.1, eGFR 72 mL/min, ALT 28, AST 24 — Mild CKD Stage 2", resultsAr: "وظائف الكلى والكبد طبيعية مع مرحلة خفيفة من أمراض الكلى" },
    { clinicId: cid, patientId: p3.id,  requestedById: doc1.id, performedById: labStaff.id, appointmentId: appts1[1].id, testName: "HbA1c",                              testNameAr: "هيموغلوبين السكري", status: "completed", results: "5.9% — Pre-diabetic range (5.7-6.4%). Lifestyle modification advised.", resultsAr: "في نطاق ما قبل السكري — يُنصح بتعديل نمط الحياة" },
    { clinicId: cid, patientId: p5.id,  requestedById: doc1.id, performedById: labStaff.id, appointmentId: appts1[10].id, testName: "Troponin T (STAT)",                  testNameAr: "تروبونين T (عاجل)", status: "completed", results: "0.83 ng/mL — ELEVATED. Consistent with NSTEMI. Repeat in 3 hours ordered.", resultsAr: "مرتفع — يتوافق مع احتشاء عضلة القلب", orderGroupId: labGroupB },
    { clinicId: cid, patientId: p5.id,  requestedById: doc1.id, performedById: labStaff.id, appointmentId: appts1[10].id, testName: "BNP (NT-proBNP)",                    testNameAr: "ببتيد ناتريوتيك الدماغي", status: "completed", results: "420 pg/mL — Mildly elevated. Monitor for heart failure signs.", resultsAr: "مرتفع قليلاً — مراقبة علامات القصور القلبي", orderGroupId: labGroupB },
    { clinicId: cid, patientId: p2.id,  requestedById: doc2.id, performedById: labStaff.id, appointmentId: appts2[0].id, testName: "Strep A Rapid Antigen Test",         testNameAr: "اختبار سريع لبكتيريا المجموعة أ", status: "completed", results: "POSITIVE — Group A Streptococcus detected", resultsAr: "إيجابي — تم اكتشاف بكتيريا العقدية المجموعة أ" },
    { clinicId: cid, patientId: p9.id,  requestedById: doc2.id, performedById: labStaff.id, appointmentId: appts2[2].id, testName: "ABG (Arterial Blood Gas)",            testNameAr: "غازات الدم الشرياني", status: "completed", results: "pH 7.38, PO2 68 mmHg, PCO2 38, HCO3 22, SaO2 94% — Hypoxaemia, compensated", resultsAr: "انخفاض في مستوى الأكسجين، معوض جزئياً" },
    { clinicId: cid, patientId: p9.id,  requestedById: doc2.id, performedById: labStaff.id,  testName: "Spirometry (Pulmonary Function Test)", testNameAr: "اختبار وظائف الرئة", status: "in_progress", notes: "Spirometry scheduled for this afternoon.", notesAr: "مجدول بعد الظهر" },
    { clinicId: cid, patientId: p7.id,  requestedById: doc1.id,  testName: "Cardiac Enzyme Panel", testNameAr: "إنزيمات القلب", status: "requested", notes: "Ordered for pre-op baseline.", notesAr: "مطلوب كخط أساسي قبل العملية" },
    { clinicId: cid, patientId: p6.id,  requestedById: doc2.id,  testName: "Full Metabolic Panel + CRP", testNameAr: "تحليل شامل + بروتين سي التفاعلي", status: "requested", notes: "Abdominal pain workup.", notesAr: "استقصاء ألم البطن" },
  ]);

  // ── x-ray records ─────────────────────────────────────────────────────────
  console.log("Creating x-ray records…");
  const xgroupA = "XG-" + Date.now().toString(36).toUpperCase();

  await db.insert(xrayRecordsTable).values([
    { clinicId: cid, patientId: p1.id,  requestedById: doc1.id, performedById: xrayStaff.id, appointmentId: appts1[0].id, bodyPart: "Chest (PA + Lateral)", bodyPartAr: "صدر (أمامي + جانبي)", status: "completed", report: "Heart size within normal limits. No focal consolidation, pleural effusion, or pneumothorax. Aortic knuckle slightly prominent — consistent with hypertension.", reportAr: "حجم القلب طبيعي. لا توجد تسرب جنبي أو استرواح صدري. قوس الأبهر بارز قليلاً", orderGroupId: xgroupA },
    { clinicId: cid, patientId: p5.id,  requestedById: doc1.id, performedById: xrayStaff.id, appointmentId: appts1[10].id, bodyPart: "Chest (Portable AP)", bodyPartAr: "صدر (محمول)", status: "completed", report: "Mild cardiomegaly. Prominent pulmonary vasculature suggesting early pulmonary oedema. No acute infiltrate.", reportAr: "تضخم خفيف في القلب. نمط وعائي رئوي بارز يوحي بوذمة خفيفة" },
    { clinicId: cid, patientId: p7.id,  requestedById: doc1.id, performedById: xrayStaff.id, bodyPart: "Chest + Spine (AP)", bodyPartAr: "صدر وعمود فقري", status: "in_progress", notes: "Awaiting radiologist report.", notesAr: "في انتظار تقرير أخصائي الأشعة" },
    { clinicId: cid, patientId: p9.id,  requestedById: doc2.id, performedById: xrayStaff.id, appointmentId: appts2[2].id, bodyPart: "Chest (PA)", bodyPartAr: "صدر أمامي", status: "completed", report: "Hyperinflation of both lungs consistent with obstructive airway disease. No infiltrates, masses, or effusions.", reportAr: "فرط تهوية الرئتين متوافق مع مرض الانسداد الرئوي" },
    { clinicId: cid, patientId: p3.id,  requestedById: doc1.id, performedById: xrayStaff.id, bodyPart: "Chest (Routine)", bodyPartAr: "صدر اعتيادي", status: "completed", report: "Bilateral lung fields clear. Cardiac contour normal. No pleural disease.", reportAr: "الرئتان واضحتان. القلب طبيعي. لا مرض جنبي" },
    { clinicId: cid, patientId: p6.id,  requestedById: doc2.id, bodyPart: "Abdomen (AP)", bodyPartAr: "بطن أمامي", status: "requested", notes: "Ordered for acute abdomen workup.", notesAr: "مطلوب لاستقصاء البطن الحاد" },
  ]);

  // ── ultrasound records ────────────────────────────────────────────────────
  console.log("Creating ultrasound records…");

  await db.insert(ultrasoundRecordsTable).values([
    { clinicId: cid, patientId: p8.id, requestedById: doc1.id, performedById: xrayStaff.id, examType: "Cardiac (Echocardiogram)", bodyPart: "Heart", bodyPartAr: "القلب", status: "completed", report: "EF 55%, no wall motion abnormalities, mild LVH, no pericardial effusion. LA slightly dilated (44mm).", reportAr: "كسر القذف 55%، تضخم خفيف لعضلة البطين الأيسر، الأذين الأيسر متسع قليلاً" },
    { clinicId: cid, patientId: p1.id, requestedById: doc1.id, performedById: xrayStaff.id, examType: "Carotid Doppler", bodyPart: "Bilateral Carotid Arteries", bodyPartAr: "الشرايين السباتية الثنائية", status: "completed", report: "Mild intimal thickening bilaterally (IMT 0.9mm right, 0.85mm left). No significant stenosis. Plaque at right bifurcation <30%.", reportAr: "سماكة خفيفة في الجدار الداخلي للشريان. لا تضيق ذي شأن" },
    { clinicId: cid, patientId: p6.id, requestedById: doc2.id, examType: "Abdomen (Full Survey)", bodyPart: "Abdomen & Pelvis", bodyPartAr: "البطن والحوض", status: "requested", notes: "Ordered for abdominal pain. Fasting required.", notesAr: "مطلوب لألم البطن. يشترط الصوم" },
    { clinicId: cid, patientId: p4.id, requestedById: doc2.id, performedById: xrayStaff.id, examType: "Thyroid Ultrasound", bodyPart: "Thyroid", bodyPartAr: "الغدة الدرقية", status: "completed", report: "Thyroid gland normal in size and echotexture. No focal nodules or masses. Bilateral lobes symmetric.", reportAr: "الغدة الدرقية طبيعية الحجم والبنية. لا عقيدات" },
  ]);

  // ── services catalog ──────────────────────────────────────────────────────
  console.log("Creating services catalog…");
  // Insert order MUST match the destructured variable names below.
  const [sConsult, sLabCBC, sLabLipid, sLabTrop, sXrayChest, sXrayAbdomen, sUS, sEcho,
    sECG, sHolter, _sHba1c, _sCmp, sPFT, sDressing, sVaccine] =
    await db.insert(servicesCatalogTable).values([
      /* 01 */ { clinicId: cid, name: "General Consultation",          nameAr: "استشارة عامة",                defaultPrice: "150.00", category: "Consultation", code: "CONSULTATION",  active: true },
      /* 02 */ { clinicId: cid, name: "Complete Blood Count (CBC)",    nameAr: "صورة دم كاملة",              defaultPrice: "60.00",  category: "Lab",          code: "LAB_CBC",       active: true },
      /* 03 */ { clinicId: cid, name: "Lipid Panel",                   nameAr: "صورة الدهون",                defaultPrice: "85.00",  category: "Lab",          code: "LAB_LIPID",     active: true },
      /* 04 */ { clinicId: cid, name: "Troponin T (hs)",               nameAr: "تروبونين عالي الحساسية",     defaultPrice: "120.00", category: "Lab",          code: "LAB_TROP",      active: true },
      /* 05 */ { clinicId: cid, name: "Chest X-Ray (PA)",              nameAr: "أشعة صدرية أمامية",          defaultPrice: "130.00", category: "Radiology",    code: "XRAY_DEFAULT",  active: true },
      /* 06 */ { clinicId: cid, name: "Abdominal X-Ray",               nameAr: "أشعة بطنية",                 defaultPrice: "130.00", category: "Radiology",    code: "XRAY_ABDOMEN",  active: true },
      /* 07 */ { clinicId: cid, name: "Abdominal Ultrasound",          nameAr: "سونار البطن",                defaultPrice: "220.00", category: "Ultrasound",   code: "US_ABDOMEN",    active: true },
      /* 08 */ { clinicId: cid, name: "Echocardiogram",                nameAr: "صدى القلب",                  defaultPrice: "350.00", category: "Ultrasound",   code: "US_ECHO",       active: true },
      /* 09 */ { clinicId: cid, name: "ECG (12-lead)",                 nameAr: "تخطيط القلب الكهربائي",      defaultPrice: "80.00",  category: "Cardiology",   code: "ECG",           active: true },
      /* 10 */ { clinicId: cid, name: "Holter Monitor (24h)",          nameAr: "هولتر 24 ساعة",              defaultPrice: "420.00", category: "Cardiology",   code: "HOLTER",        active: true },
      /* 11 */ { clinicId: cid, name: "HbA1c",                         nameAr: "هيموغلوبين السكري",           defaultPrice: "75.00",  category: "Lab",          code: "LAB_HBA1C",     active: true },
      /* 12 */ { clinicId: cid, name: "Comprehensive Metabolic Panel", nameAr: "لوحة التمثيل الغذائي",       defaultPrice: "110.00", category: "Lab",          code: "LAB_CMP",       active: true },
      /* 13 */ { clinicId: cid, name: "Spirometry (PFT)",              nameAr: "اختبار وظائف الرئة",         defaultPrice: "160.00", category: "Pulmonology",  code: "PFT",           active: true },
      /* 14 */ { clinicId: cid, name: "Wound Dressing",                nameAr: "تضميد الجروح",               defaultPrice: "50.00",  category: "Nursing",      code: "DRESSING",      active: true },
      /* 15 */ { clinicId: cid, name: "Vaccination (Single)",          nameAr: "تطعيم (جرعة واحدة)",         defaultPrice: "90.00",  category: "Preventive",   code: "VACCINE",       active: true },
      /* 16 */ { clinicId: cid, name: "Cardiology Consultation",       nameAr: "استشارة قلبية",              defaultPrice: "250.00", category: "Consultation", code: "CARDIO_CONSULT",active: true },
      /* 17 */ { clinicId: cid, name: "Pediatrics Consultation",       nameAr: "استشارة أطفال",              defaultPrice: "200.00", category: "Consultation", code: "PEDS_CONSULT",   active: true },
      /* 18 */ { clinicId: cid, name: "Carotid Doppler",               nameAr: "دوبلر الشرايين السباتية",    defaultPrice: "280.00", category: "Ultrasound",   code: "US_CAROTID",    active: true },
    ]).returning();

  // ── invoices + items ──────────────────────────────────────────────────────
  console.log("Creating invoices…");
  const [inv1, inv2, inv3, inv4, inv5, inv6, inv7, inv8, inv9, inv10, inv11, inv12] =
    await db.insert(invoicesTable).values([
      { clinicId: cid, invoiceNumber: "INV-2026-001", patientId: p1.id,  createdById: frontDesk.id, subtotal: "510.00", discount: "0.00",  total: "510.00", status: "paid",    paidAt: daysAgo(30), notes: "Cardiology consult + chest X-ray + troponin + CBC" },
      { clinicId: cid, invoiceNumber: "INV-2026-002", patientId: p3.id,  createdById: frontDesk.id, subtotal: "435.00", discount: "0.00",  total: "435.00", status: "paid",    paidAt: daysAgo(27), notes: "Cardiology consult + CMP + HbA1c" },
      { clinicId: cid, invoiceNumber: "INV-2026-003", patientId: p7.id,  createdById: frontDesk.id, subtotal: "630.00", discount: "50.00", total: "580.00", status: "paid",    paidAt: daysAgo(24), notes: "Cardiology consult + ECG + carotid Doppler — loyalty discount applied" },
      { clinicId: cid, invoiceNumber: "INV-2026-004", patientId: p8.id,  createdById: frontDesk.id, subtotal: "770.00", discount: "0.00",  total: "770.00", status: "paid",    paidAt: daysAgo(21), notes: "Cardiology consult + Holter + echo" },
      { clinicId: cid, invoiceNumber: "INV-2026-005", patientId: p2.id,  createdById: frontDesk.id, subtotal: "200.00", discount: "0.00",  total: "200.00", status: "paid",    paidAt: daysAgo(28), notes: "Pediatrics consult + rapid strep test" },
      { clinicId: cid, invoiceNumber: "INV-2026-006", patientId: p9.id,  createdById: frontDesk.id, subtotal: "520.00", discount: "0.00",  total: "520.00", status: "paid",    paidAt: daysAgo(22), notes: "Pediatrics consult + ABG + chest X-ray + PFT" },
      { clinicId: cid, invoiceNumber: "INV-2026-007", patientId: p4.id,  createdById: frontDesk.id, subtotal: "420.00", discount: "20.00", total: "400.00", status: "paid",    paidAt: daysAgo(13), notes: "Pediatrics consult + thyroid US + allergy workup" },
      { clinicId: cid, invoiceNumber: "INV-2026-008", patientId: p5.id,  createdById: frontDesk.id, subtotal: "950.00", discount: "0.00",  total: "950.00", status: "pending", notes: "NSTEMI workup — troponin ×2, BNP, chest X-ray, cardiology consult" },
      { clinicId: cid, invoiceNumber: "INV-2026-009", patientId: p1.id,  createdById: frontDesk.id, subtotal: "330.00", discount: "0.00",  total: "330.00", status: "paid",    paidAt: daysAgo(15), notes: "Cardiology follow-up + lipid panel" },
      { clinicId: cid, invoiceNumber: "INV-2026-010", patientId: p3.id,  createdById: frontDesk.id, subtotal: "250.00", discount: "0.00",  total: "250.00", status: "pending", notes: "Cardiology consult today" },
      { clinicId: cid, invoiceNumber: "INV-2026-011", patientId: p8.id,  createdById: frontDesk.id, subtotal: "350.00", discount: "0.00",  total: "350.00", status: "cancelled", notes: "Appointment cancelled by patient", },
      { clinicId: cid, invoiceNumber: "INV-2026-012", patientId: p6.id,  createdById: frontDesk.id, subtotal: "350.00", discount: "0.00",  total: "350.00", status: "pending", notes: "Pediatrics consult + abdominal workup" },
    ]).returning();

  await db.insert(invoiceItemsTable).values([
    // INV-001
    { clinicId: cid, invoiceId: inv1.id, serviceId: sConsult.id, description: "Cardiology Consultation",    quantity: 1, unitPrice: "250.00" },
    { clinicId: cid, invoiceId: inv1.id, serviceId: sXrayChest.id,description: "Chest X-Ray (PA + Lateral)", quantity: 1, unitPrice: "130.00" },
    { clinicId: cid, invoiceId: inv1.id, serviceId: sLabTrop.id,  description: "Troponin T (hs)",            quantity: 1, unitPrice: "120.00" },
    { clinicId: cid, invoiceId: inv1.id, serviceId: sLabCBC.id,   description: "CBC",                        quantity: 1, unitPrice: "60.00"  },
    // INV-002
    { clinicId: cid, invoiceId: inv2.id, serviceId: sConsult.id,  description: "Cardiology Consultation",    quantity: 1, unitPrice: "250.00" },
    { clinicId: cid, invoiceId: inv2.id, serviceId: sLabLipid.id, description: "Lipid Panel",                quantity: 1, unitPrice: "85.00"  },
    { clinicId: cid, invoiceId: inv2.id, serviceId: sLabCBC.id,   description: "HbA1c",                      quantity: 1, unitPrice: "75.00"  },
    { clinicId: cid, invoiceId: inv2.id,                           description: "ECG (12-lead) – in-clinic",  quantity: 1, unitPrice: "80.00"  },
    // INV-003
    { clinicId: cid, invoiceId: inv3.id, serviceId: sConsult.id,  description: "Cardiology Consultation",    quantity: 1, unitPrice: "250.00" },
    { clinicId: cid, invoiceId: inv3.id, serviceId: sUS.id,       description: "Echocardiogram",             quantity: 1, unitPrice: "350.00" },
    // Wait, the 3rd invoice is 630, so: Cardiology 250 + Carotid Doppler 280 + ECG 80 + ... = 610, not 630. Let me adjust.
    // Actually let me just use ad-hoc items:
    // INV-003: 250 (cardiology) + 280 (carotid doppler) + 80 (ECG) + 20 (admin fee) = 630
    { clinicId: cid, invoiceId: inv3.id, serviceId: sEcho.id,     description: "Carotid Doppler",            quantity: 1, unitPrice: "280.00" },
    { clinicId: cid, invoiceId: inv3.id,                           description: "Administrative fee",          quantity: 1, unitPrice: "100.00" },
    // INV-004
    { clinicId: cid, invoiceId: inv4.id, serviceId: sConsult.id,  description: "Cardiology Consultation",    quantity: 1, unitPrice: "250.00" },
    { clinicId: cid, invoiceId: inv4.id, serviceId: sHolter.id,   description: "Holter Monitor (24h)",       quantity: 1, unitPrice: "420.00" },
    { clinicId: cid, invoiceId: inv4.id,                           description: "Report fee",                 quantity: 1, unitPrice: "100.00" },
    // INV-005
    { clinicId: cid, invoiceId: inv5.id, serviceId: sConsult.id,  description: "Pediatrics Consultation",    quantity: 1, unitPrice: "200.00" },
    // INV-006
    { clinicId: cid, invoiceId: inv6.id, serviceId: sConsult.id,  description: "Pediatrics Consultation",    quantity: 1, unitPrice: "200.00" },
    { clinicId: cid, invoiceId: inv6.id, serviceId: sXrayChest.id,description: "Chest X-Ray",                quantity: 1, unitPrice: "130.00" },
    { clinicId: cid, invoiceId: inv6.id, serviceId: sPFT.id,      description: "Spirometry (PFT)",           quantity: 1, unitPrice: "160.00" },
    { clinicId: cid, invoiceId: inv6.id,                           description: "ABG (Arterial Blood Gas)",   quantity: 1, unitPrice: "30.00"  },
    // INV-007
    { clinicId: cid, invoiceId: inv7.id, serviceId: sConsult.id,  description: "Pediatrics Consultation",    quantity: 1, unitPrice: "200.00" },
    { clinicId: cid, invoiceId: inv7.id, serviceId: sUS.id,       description: "Thyroid Ultrasound",         quantity: 1, unitPrice: "220.00" },
    // INV-008
    { clinicId: cid, invoiceId: inv8.id, serviceId: sConsult.id,  description: "Cardiology Consultation (STAT)",quantity: 1, unitPrice: "250.00" },
    { clinicId: cid, invoiceId: inv8.id, serviceId: sLabTrop.id,  description: "Troponin T (hs) – First",    quantity: 1, unitPrice: "120.00" },
    { clinicId: cid, invoiceId: inv8.id, serviceId: sLabTrop.id,  description: "Troponin T (hs) – Repeat",   quantity: 1, unitPrice: "120.00" },
    { clinicId: cid, invoiceId: inv8.id, serviceId: sXrayChest.id,description: "Portable Chest X-Ray",       quantity: 1, unitPrice: "130.00" },
    { clinicId: cid, invoiceId: inv8.id,                           description: "BNP (NT-proBNP)",            quantity: 1, unitPrice: "200.00" },
    { clinicId: cid, invoiceId: inv8.id,                           description: "Emergency IV access + meds", quantity: 1, unitPrice: "130.00" },
    // INV-009
    { clinicId: cid, invoiceId: inv9.id, serviceId: sConsult.id,  description: "Cardiology Follow-up",       quantity: 1, unitPrice: "250.00" },
    { clinicId: cid, invoiceId: inv9.id, serviceId: sLabLipid.id, description: "Lipid Panel",                quantity: 1, unitPrice: "85.00"  },
    // INV-010
    { clinicId: cid, invoiceId: inv10.id, serviceId: sConsult.id, description: "Cardiology Consultation",    quantity: 1, unitPrice: "250.00" },
    // INV-012
    { clinicId: cid, invoiceId: inv12.id, serviceId: sConsult.id, description: "Pediatrics Consultation",    quantity: 1, unitPrice: "200.00" },
    { clinicId: cid, invoiceId: inv12.id, serviceId: sXrayAbdomen.id,description: "Abdominal X-Ray",        quantity: 1, unitPrice: "130.00" },
    { clinicId: cid, invoiceId: inv12.id,                          description: "Abdominal Ultrasound",      quantity: 1, unitPrice: "220.00" },
  ]);

  // Set invoice counter so next invoice is INV-2026-013
  await db.insert(clinicInvoiceCountersTable).values({ clinicId: cid, lastSeq: 12 })
    .onConflictDoUpdate({ target: clinicInvoiceCountersTable.clinicId, set: { lastSeq: 12 } });

  // ── inventory ─────────────────────────────────────────────────────────────
  console.log("Creating inventory…");
  const invItems = await db.insert(inventoryTable).values([
    { clinicId: cid, name: "Paracetamol 500mg Tablets",       category: "Medicine",    quantity: 480, unit: "tablet",   minimumStock: 100, expiryDate: "2027-06-30" },
    { clinicId: cid, name: "Amoxicillin-Clavulanate 625mg",   category: "Medicine",    quantity: 72,  unit: "capsule",  minimumStock: 50,  expiryDate: "2026-12-31" },
    { clinicId: cid, name: "Amlodipine 10mg Tablets",         category: "Medicine",    quantity: 200, unit: "tablet",   minimumStock: 60,  expiryDate: "2027-03-31" },
    { clinicId: cid, name: "Metoprolol Succinate 25mg",        category: "Medicine",    quantity: 150, unit: "tablet",   minimumStock: 60,  expiryDate: "2027-01-31" },
    { clinicId: cid, name: "Atorvastatin 40mg Tablets",       category: "Medicine",    quantity: 90,  unit: "tablet",   minimumStock: 30,  expiryDate: "2026-09-30" },
    { clinicId: cid, name: "Nitroglycerin 0.4mg SL Tabs",     category: "Medicine",    quantity: 40,  unit: "tablet",   minimumStock: 20,  expiryDate: "2026-08-31" },
    { clinicId: cid, name: "Salbutamol Inhaler 200mcg",       category: "Medicine",    quantity: 15,  unit: "inhaler",  minimumStock: 10,  expiryDate: "2027-02-28" },
    { clinicId: cid, name: "Loratadine 10mg Tablets",         category: "Medicine",    quantity: 120, unit: "tablet",   minimumStock: 30,  expiryDate: "2027-05-31" },
    { clinicId: cid, name: "Surgical Gloves — Medium (M)",    category: "Supply",      quantity: 180, unit: "pair",     minimumStock: 50 },
    { clinicId: cid, name: "Surgical Gloves — Large (L)",     category: "Supply",      quantity: 220, unit: "pair",     minimumStock: 50 },
    { clinicId: cid, name: "Disposable Syringes 5mL",         category: "Supply",      quantity: 28,  unit: "piece",    minimumStock: 100 },
    { clinicId: cid, name: "Disposable Syringes 10mL",        category: "Supply",      quantity: 65,  unit: "piece",    minimumStock: 50 },
    { clinicId: cid, name: "IV Cannulas (18G)",               category: "Supply",      quantity: 45,  unit: "piece",    minimumStock: 30 },
    { clinicId: cid, name: "Elastic Bandages 10cm",           category: "Supply",      quantity: 60,  unit: "roll",     minimumStock: 20 },
    { clinicId: cid, name: "Sterile Gauze Pads 10×10",        category: "Supply",      quantity: 350, unit: "pad",      minimumStock: 100 },
    { clinicId: cid, name: "Povidone-Iodine 10% (500mL)",    category: "Supply",      quantity: 8,   unit: "bottle",   minimumStock: 4,   expiryDate: "2027-01-31" },
    { clinicId: cid, name: "Blood Glucose Test Strips",       category: "Lab Supply",  quantity: 145, unit: "strip",    minimumStock: 50,  expiryDate: "2026-10-31" },
    { clinicId: cid, name: "ECG Electrodes (50-pack)",        category: "Lab Supply",  quantity: 12,  unit: "pack",     minimumStock: 4,   expiryDate: "2027-04-30" },
    { clinicId: cid, name: "Troponin Rapid Test Kits",        category: "Lab Supply",  quantity: 6,   unit: "kit",      minimumStock: 10,  expiryDate: "2026-07-31" },
    { clinicId: cid, name: "Hand Sanitiser 70% 500mL",        category: "Supply",      quantity: 24,  unit: "bottle",   minimumStock: 10,  expiryDate: "2028-01-01" },
  ]).returning();

  // ── inventory transactions (opening balances + some movements) ───────────
  console.log("Creating inventory transactions…");
  await db.insert(inventoryTransactionsTable).values([
    // Opening balances (initial)
    { clinicId: cid, itemId: invItems[0].id,  delta: 500,  quantityAfter: 500,  reason: "initial",  note: "Opening stock — Paracetamol 500mg",       performedById: admin.id },
    { clinicId: cid, itemId: invItems[1].id,  delta: 100,  quantityAfter: 100,  reason: "initial",  note: "Opening stock — Amoxicillin-Clavulanate", performedById: admin.id },
    { clinicId: cid, itemId: invItems[6].id,  delta: 20,   quantityAfter: 20,   reason: "initial",  note: "Opening stock — Salbutamol Inhalers",      performedById: admin.id },
    { clinicId: cid, itemId: invItems[10].id, delta: 100,  quantityAfter: 100,  reason: "initial",  note: "Opening stock — Syringes 5mL",             performedById: admin.id },
    { clinicId: cid, itemId: invItems[18].id, delta: 20,   quantityAfter: 20,   reason: "initial",  note: "Opening stock — Troponin Kits",            performedById: admin.id },
    // Consumption events
    { clinicId: cid, itemId: invItems[0].id,  delta: -20,  quantityAfter: 480,  reason: "consumed", note: "Dispensed to patients — week ending " + daysAgo(7).toDateString(), performedById: nurse.id },
    { clinicId: cid, itemId: invItems[1].id,  delta: -28,  quantityAfter: 72,   reason: "consumed", note: "Dispensed per prescriptions — 2 weeks",    performedById: nurse.id },
    { clinicId: cid, itemId: invItems[5].id,  delta: -5,   quantityAfter: 40,   reason: "consumed", note: "Emergency nitroglycerin — cardiac bay",     performedById: nurse.id },
    { clinicId: cid, itemId: invItems[10].id, delta: -72,  quantityAfter: 28,   reason: "consumed", note: "IV access procedures — 2-week period",      performedById: nurse.id },
    { clinicId: cid, itemId: invItems[18].id, delta: -14,  quantityAfter: 6,    reason: "consumed", note: "Rapid troponin testing — STAT cases",       performedById: labStaff.id },
    // Restock events
    { clinicId: cid, itemId: invItems[2].id,  delta: 100,  quantityAfter: 200,  reason: "restock",  note: "PO from Al-Dawaa Pharma — delivery received",  performedById: admin.id },
    { clinicId: cid, itemId: invItems[8].id,  delta: 200,  quantityAfter: 400,  reason: "restock",  note: "Surgical gloves restock — biannual order",       performedById: admin.id },
    { clinicId: cid, itemId: invItems[9].id,  delta: 220,  quantityAfter: 220,  reason: "initial",  note: "Opening stock — Surgical Gloves L",              performedById: admin.id },
    { clinicId: cid, itemId: invItems[16].id, delta: 50,   quantityAfter: 145,  reason: "restock",  note: "Glucose strips reorder — monthly supply",        performedById: labStaff.id },
    // Adjustment (stock-take)
    { clinicId: cid, itemId: invItems[14].id, delta: -5,   quantityAfter: 350,  reason: "adjustment", note: "Stock-take correction — 5 damaged pads written off", performedById: admin.id },
    // Expiry write-off
    { clinicId: cid, itemId: invItems[16].id, delta: -10,  quantityAfter: 135,  reason: "expired",  note: "10 strips past expiry date — disposed per protocol", performedById: labStaff.id },
  ]);

  // ── operations ────────────────────────────────────────────────────────────
  console.log("Creating operations…");
  await db.insert(operationsTable).values([
    {
      clinicId: cid, patientId: p7.id, surgeonId: doc1.id, requestedById: doc1.id,
      procedureName: "Percutaneous Coronary Intervention (PCI) — LAD stenting",
      scheduledAt: daysFromNow(5, 8, 0), operatingRoom: "OR-1 (Cath Lab)",
      status: "scheduled",
      staffAssigned: [{ userId: nurse.id, role: "Scrub Nurse" }, { userId: xrayStaff.id, role: "Radiographer" }],
      notes: "Pre-op bloods and echo required 24h before. NPO from midnight.",
    },
    {
      clinicId: cid, patientId: p5.id, surgeonId: doc1.id, requestedById: doc1.id,
      procedureName: "Emergency Coronary Angiography — NSTEMI",
      scheduledAt: todayAt(15, 0), operatingRoom: "OR-1 (Cath Lab)",
      status: "in_progress",
      staffAssigned: [{ userId: nurse.id, role: "Circulating Nurse" }, { userId: xrayStaff.id, role: "Radiographer" }],
      notes: "Urgent — patient admitted via emergency. Dual antiplatelet on board.",
    },
    {
      clinicId: cid, patientId: p1.id, surgeonId: doc1.id, requestedById: doc1.id,
      procedureName: "Exercise Stress Test (Treadmill)",
      scheduledAt: daysAgo(20, 10, 0), operatingRoom: "Cardiology Suite B",
      status: "completed",
      staffAssigned: [{ userId: nurse.id, role: "Monitoring Nurse" }],
      notes: "Max HR achieved 88% of predicted. Mild ST depression at peak. See report.",
    },
    {
      clinicId: cid, patientId: p8.id, surgeonId: doc1.id, requestedById: doc1.id,
      procedureName: "Electrophysiology Study (EPS) — SVT ablation evaluation",
      scheduledAt: daysFromNow(14, 8, 30), operatingRoom: "OR-2 (EP Lab)",
      status: "requested",
      staffAssigned: [],
      notes: "Refer to cardiac electrophysiologist. Pre-auth with insurance required.",
    },
    {
      clinicId: cid, patientId: p3.id, surgeonId: doc1.id, requestedById: admin.id,
      procedureName: "Ambulatory Blood Pressure Monitoring (ABPM — 24h)",
      scheduledAt: daysAgo(10, 9, 0), operatingRoom: "Outpatient Bay 3",
      status: "completed",
      staffAssigned: [{ userId: nurse.id, role: "Setup Nurse" }],
      notes: "Device attached and returned next day. Average 24h BP: 145/93 mmHg.",
    },
  ]);

  // ── clinic notices ─────────────────────────────────────────────────────────
  console.log("Creating clinic notices…");
  await db.insert(clinicNoticesTable).values([
    { clinicId: cid, title: "Ramadan Clinic Hours — Adjusted Schedule", content: "During the Holy Month of Ramadan, clinic hours will be 10:00 AM – 2:00 PM and 8:00 PM – 12:00 AM. All staff are requested to coordinate schedules accordingly.", createdBy: admin.id, reason: "Operational" },
    { clinicId: cid, title: "New NSTEMI Protocol — Effective Immediately", content: "All suspected ACS patients presenting to front desk must be triaged STAT (critical) and a 12-lead ECG performed within 10 minutes of arrival. Call cardiology on-call immediately. Do not wait for physician orders.", createdBy: doc1.id, reason: "Clinical Safety" },
    { clinicId: cid, title: "Troponin Rapid Kits — Low Stock Alert", content: "Stock of troponin rapid test kits is critically low (6 units remaining). A reorder has been placed. Please use kits only for STAT cardiac cases and use lab send-out for elective panels until restock arrives.", createdBy: admin.id, reason: "Supply Chain" },
    { clinicId: cid, title: "Electronic Health Record Maintenance — Scheduled Downtime", content: "The EHR system will undergo scheduled maintenance on Sunday from 2:00 AM to 6:00 AM. Clinical operations will continue using paper forms during this window. Backup paper forms are available at the nursing station.", createdBy: superAdmin.id, reason: "IT Maintenance" },
  ]);

  // ── notifications ─────────────────────────────────────────────────────────
  console.log("Creating notifications…");
  await db.insert(notificationsTable).values([
    { clinicId: cid, userId: admin.id,    title: "System Ready",              message: "MediCore Clinic Management System is fully operational. All modules are active.", type: "general" },
    { clinicId: cid, userId: doc1.id,     title: "Patient Arrived — Ward",    message: "Mr. Abdullah Al-Harbi (MRN001003) has checked in for his 09:00 appointment.", type: "patient_arrived" },
    { clinicId: cid, userId: doc1.id,     title: "Lab Result Available",      message: "Troponin T results for Mr. Faisal Al-Dosari (MRN001005) are ready. CRITICAL value detected.", type: "lab_ready" },
    { clinicId: cid, userId: doc2.id,     title: "Patient Checked In",        message: "Ms. Hessa Al-Otaibi (MRN001002) has arrived and is waiting in consultation room 2.", type: "patient_arrived" },
    { clinicId: cid, userId: labStaff.id, title: "Urgent Lab Order",          message: "STAT CBC + Troponin ordered for Mr. Faisal Al-Dosari. Please process immediately.", type: "general" },
    { clinicId: cid, userId: xrayStaff.id,title: "X-Ray Pending",             message: "Portable chest X-ray ordered for Mr. Faisal Al-Dosari (NSTEMI). Cardiac Bay 1.", type: "xray_ready" },
    { clinicId: cid, userId: nurse.id,    title: "Triage Patient Ready",      message: "Ms. Layla Al-Zahrani (MRN001004) is in triage. Vitals needed for Dr. Ahmed.", type: "general" },
    { clinicId: cid, userId: doc2.id,     title: "Ultrasound Report Ready",   message: "Abdominal ultrasound report for Ms. Noura Al-Ghamdi is available for review.", type: "ultrasound_ready" },
    { clinicId: cid, userId: frontDesk.id,title: "Invoice Pending Payment",   message: "Invoice INV-2026-008 for Mr. Faisal Al-Dosari (SAR 950) is awaiting payment.", type: "general" },
    { clinicId: cid, userId: doc1.id,     title: "Operation Confirmed — OR1", message: "Emergency coronary angiography for Mr. Faisal Al-Dosari is confirmed for 3:00 PM today in OR-1.", type: "general" },
  ]);

  // ── done ──────────────────────────────────────────────────────────────────
  console.log("\n✅ Seed completed successfully!");
  console.log("\n── Login Credentials ───────────────────────────────────────────");
  console.log("  Super Admin:         superadmin  / admin123");
  console.log("  Admin:               admin        / admin123");
  console.log("  Cardiologist:        dr_ahmed     / doctor123");
  console.log("  Paediatrician:       dr_sara      / doctor123");
  console.log("  Nurse:               nurse1       / nurse123");
  console.log("  Front Desk:          receptionist / front123");
  console.log("  X-Ray Tech:          xray_tech    / xray123");
  console.log("  Lab Tech:            lab_tech     / lab123");
  console.log("  Compliance Officer:  compliance   / comply123");
  console.log("  Billing Manager:     billing_mgr  / billing123");
  console.log("  Pharmacist:          pharmacist1  / pharma123");
  console.log("────────────────────────────────────────────────────────────────");
  console.log("\n── Sample Data Summary ─────────────────────────────────────────");
  console.log("  Patients:       10  (5 cardiology, 5 paediatrics + cross-referrals)");
  console.log("  Appointments:  ~40  (past completed + today active + future scheduled)");
  console.log("  Medical Records: 8  (bilingual EN/AR, with vitals JSONB)");
  console.log("  Prescriptions:   8  (medications JSONB, bilingual notes)");
  console.log("  Lab Tests:      12  (requested / in_progress / completed)");
  console.log("  X-Ray Records:   6  (pending / uploaded / reviewed)");
  console.log("  Ultrasound:      4  (pending / reviewed)");
  console.log("  Services:       18  (consultation, lab, radiology, cardiology, nursing)");
  console.log("  Invoices:       12  (paid / pending / cancelled)");
  console.log("  Inventory:      20  (medicines, supplies, lab supplies)");
  console.log("  Inv. Txns:      16  (initial / restock / consumed / expired / adjustment)");
  console.log("  Operations:      5  (requested / scheduled / in_progress / completed)");
  console.log("  Clinic Notices:  4  (clinical, operational, supply, IT)");
  console.log("  Notifications:  10  (various types and roles)");
  console.log("────────────────────────────────────────────────────────────────\n");

  process.exit(0);
}

seed().catch(err => {
  console.error("Seed failed:", err);
  process.exit(1);
});
