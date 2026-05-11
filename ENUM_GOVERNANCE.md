# Enum Governance Policy

In PostgreSQL and Drizzle ORM, `ENUM` types represent static, predefined values (e.g., appointment status, user roles, diagnostic types). Due to PostgreSQL's strict handling of enum types, the following governance rules are enforced:

## 1. Append-Only Policy
**Rule:** You may ADD new values to an enum. You may NEVER RENAME or REMOVE existing values.
**Rationale:** Removing an enum value breaks existing rows that use that value. Renaming an enum requires a complex, locking database migration that risks production downtime.

## 2. Deprecation Process
If a status like `in_progress` is no longer used:
1. Do NOT delete the value from the PostgreSQL `pg_enum`.
2. Update the frontend UI to remove it from dropdowns and selection menus.
3. Add a backend validation (e.g., Zod) that rejects incoming mutations attempting to set the deprecated value.
4. Optionally, run a background migration script to update legacy rows to the new appropriate status.

## 3. Review Process
Any Pull Request that modifies an `export const` array representing an enum in the codebase must receive a secondary code review.
