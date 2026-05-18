// Centralized auth constants to prevent ESM circular dependencies
// between auth.ts and the runtime stores.

/** 
 * The longest per-role JWT TTL in seconds (4h).
 * Used by revocation stores to bound sweep/eviction windows.
 */
export const MAX_ROLE_TTL_SEC = 4 * 60 * 60; // 4 hours
