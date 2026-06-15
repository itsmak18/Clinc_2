-- IF NOT EXISTS added by hand: these sequences already exist in every
-- environment where the dev seed has run (it created them with
-- `CREATE SEQUENCE IF NOT EXISTS`). Plain CREATE SEQUENCE would abort the
-- migration there. On a fresh (migrated-but-unseeded) prod DB they are created
-- here — which is the whole point (see schema/sequences.ts).
CREATE SEQUENCE IF NOT EXISTS "public"."invoice_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1000 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS "public"."mrn_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1001 CACHE 1;
