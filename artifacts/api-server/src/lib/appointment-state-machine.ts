/**
 * appointment-state-machine.ts
 *
 * Defines the VALID state transitions for appointments and provides
 * an enforcement function for route handlers.
 *
 * Rules:
 *  - Transitions are forward-only (terminal states cannot move backward).
 *  - Each transition is role-restricted.
 *  - An invalid transition returns a 422 with the allowed transitions listed.
 *
 * State diagram:
 *
 *  scheduled
 *    ↓ [checkin]         front_desk / nurse / admin / super_admin
 *  checked_in
 *    ↓ [triage]          nurse / admin / super_admin
 *  in_triage
 *    ↓ [ready]           nurse / admin / super_admin
 *  ready_for_doctor
 *    ↓ [consult]         doctor / admin / super_admin
 *  in_consultation
 *    ↓ [diagnostics]     doctor / admin / super_admin          → awaiting_diagnostics
 *    ↓ [payment]         doctor / nurse / front_desk / admin   → pending_payment
 *  awaiting_diagnostics
 *    ↓ [payment]         doctor / nurse / front_desk / admin   → pending_payment
 *  pending_payment
 *    ↓ [complete]        front_desk / admin / super_admin      → completed
 *  completed             (terminal)
 *  cancelled             (terminal)
 *  no_show               (terminal)
 */

export type AppointmentStatus =
  | "scheduled"
  | "checked_in"
  | "in_triage"
  | "ready_for_doctor"
  | "in_consultation"
  | "awaiting_diagnostics"
  | "pending_payment"
  | "completed"
  | "cancelled"
  | "no_show";

export type AppointmentAction =
  | "checkin"
  | "triage"
  | "ready"
  | "consult"
  | "diagnostics"
  | "payment"
  | "complete"
  | "cancel"
  | "no_show";

interface Transition {
  from: AppointmentStatus[];
  to: AppointmentStatus;
  allowedRoles: string[];
}

/**
 * Authoritative state machine transition table.
 * Keys are the action names (matching route path suffixes).
 */
export const TRANSITIONS: Record<AppointmentAction, Transition> = {
  checkin: {
    from: ["scheduled"],
    to: "checked_in",
    allowedRoles: ["super_admin", "admin", "front_desk", "nurse"],
  },
  triage: {
    from: ["checked_in"],
    to: "in_triage",
    allowedRoles: ["super_admin", "admin", "nurse"],
  },
  ready: {
    from: ["in_triage"],
    to: "ready_for_doctor",
    allowedRoles: ["super_admin", "admin", "nurse"],
  },
  consult: {
    from: ["ready_for_doctor"],
    to: "in_consultation",
    allowedRoles: ["super_admin", "admin", "doctor"],
  },
  diagnostics: {
    from: ["in_consultation"],
    to: "awaiting_diagnostics",
    allowedRoles: ["super_admin", "admin", "doctor"],
  },
  payment: {
    from: ["in_consultation", "awaiting_diagnostics"],
    to: "pending_payment",
    allowedRoles: ["super_admin", "admin", "doctor", "nurse", "front_desk"],
  },
  complete: {
    from: ["pending_payment"],
    to: "completed",
    allowedRoles: ["super_admin", "admin", "front_desk"],
  },
  cancel: {
    from: ["scheduled", "checked_in", "in_triage", "ready_for_doctor", "in_consultation", "awaiting_diagnostics", "pending_payment"],
    to: "cancelled",
    allowedRoles: ["super_admin", "admin", "front_desk"],
  },
  no_show: {
    from: ["scheduled", "checked_in"],
    to: "no_show",
    allowedRoles: ["super_admin", "admin", "front_desk"],
  },
};

export type TransitionResult =
  | { ok: true; toStatus: AppointmentStatus }
  | { ok: false; status: 409 | 403; error: string; detail?: object };

/**
 * Validate whether a state machine action is permitted given the current
 * appointment status and the requesting user's role.
 *
 * Returns a discriminated union — callers must check `result.ok` before proceeding.
 */
export function validateTransition(
  action: AppointmentAction,
  currentStatus: AppointmentStatus,
  userRole: string,
): TransitionResult {
  const transition = TRANSITIONS[action];

  // Guard: unknown action (shouldn't happen if routes are correct)
  if (!transition) {
    return { ok: false, status: 409, error: `Unknown action: ${action}` };
  }

  // Guard: invalid source state (wrong sequence)
  if (!transition.from.includes(currentStatus)) {
    return {
      ok: false,
      status: 409,
      error: `Cannot perform '${action}': appointment is '${currentStatus}'.`,
      detail: {
        currentStatus,
        action,
        validFromStates: transition.from,
        targetStatus: transition.to,
      },
    };
  }

  // Guard: role not permitted for this transition (super_admin always bypasses)
  if (userRole !== "super_admin" && !transition.allowedRoles.includes(userRole)) {
    return {
      ok: false,
      status: 403,
      error: `Role '${userRole}' is not permitted to perform '${action}'.`,
      detail: {
        action,
        allowedRoles: transition.allowedRoles,
      },
    };
  }

  return { ok: true, toStatus: transition.to };
}
