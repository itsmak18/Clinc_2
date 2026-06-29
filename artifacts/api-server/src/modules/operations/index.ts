/**
 * Operations module — public surface (barrel).
 *
 * Owns OR / procedure scheduling (operation_status state machine, OR-team
 * staff assignment, approval gate). Self-contained leaf — no cross-module
 * service deps. `operationsRouter` is authed.
 */
export { default as operationsRouter } from "./operations.routes";
