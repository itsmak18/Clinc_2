import { pgSequence } from "drizzle-orm/pg-core";

// Sequences backing human-readable identifiers, consumed via raw nextval():
//   - mrn_seq     → generateMRN()      in patients.service.ts (MRN-YYYYMM-NNNNN)
//   - invoice_seq → invoice numbering  in billing.service.ts
//
// Declared here so a *migration* creates them. Previously they existed ONLY
// because the dev seed ran `CREATE SEQUENCE IF NOT EXISTS` — so a freshly
// migrated-but-unseeded prod DB had no sequence, and the first patient
// registration (and first invoice) would fail with `relation "mrn_seq" does
// not exist`. Start values mirror the seed (mrn_seq 1001, invoice_seq 1000).
export const mrnSeq = pgSequence("mrn_seq", { startWith: 1001 });
export const invoiceSeq = pgSequence("invoice_seq", { startWith: 1000 });
