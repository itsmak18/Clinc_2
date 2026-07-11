/**
 * Inventory module — public surface (barrel).
 *
 * This is the ONLY path other code may import the module through. Importing a
 * deep path (e.g. `modules/inventory/inventory.service`) from outside the module
 * is forbidden — co-locate new inventory code inside this folder and export it
 * here. (Pilot module for the feature-module migration; see docs/FOLDER_STRUCTURE.md.)
 *
 * `inventoryRouter` is an authenticated router (mounts `requireAuth`); it is
 * registered in routes/index.ts after the Phase-2 anonymous routers.
 */
export { default as inventoryRouter } from "./inventory.routes";
