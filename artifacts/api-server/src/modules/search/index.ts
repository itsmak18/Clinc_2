/**
 * Search module — public surface (barrel).
 *
 * Owns global cross-entity search (doctor-scope aware). Self-contained leaf;
 * `searchRouter` is authed.
 */
export { default as searchRouter } from "./search.routes";
