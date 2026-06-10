export const AUTH_STATES = Object.freeze({
  UNENROLLED: "unenrolled",
  ENROLLED: "enrolled",
  ACTIVE_SESSION: "active_session",
  STEP_UP_FRESH: "step_up_fresh",
  STEP_UP_EXPIRED: "step_up_expired",
  LOCKED: "locked",
  RECOVERY_PENDING: "recovery_pending",
  BREAK_GLASS_PENDING_HUMAN_GATE: "break_glass_pending_human_gate"
});

export const AUTH_ACTION_POLICY = Object.freeze({
  login: { requiresCredential: true, deniedStates: [AUTH_STATES.LOCKED] },
  enrollment: { requiresPassword: true, deniedStates: [AUTH_STATES.LOCKED] },
  stepUp: { requiresCredential: true, deniedStates: [AUTH_STATES.LOCKED] },
  "provider.create": { requiresSession: true, requiresFreshStepUp: true },
  "provider.secret.rotate": { requiresSession: true, requiresFreshStepUp: true },
  "orchestrator.execute": { requiresSession: true, requiresFreshStepUp: true },
  "credential.revoke": { requiresSession: true, requiresFreshStepUp: true },
  "credential.suspend": { requiresSession: true, requiresFreshStepUp: true },
  "recovery.update": { requiresSession: true, noAutoUnlock: true },
  "break_glass.request": {
    requiresSession: true,
    humanGateRequired: true,
    sideEffectAllowed: false
  }
});

export function publicAuthPolicyMatrix() {
  return {
    states: Object.values(AUTH_STATES),
    actions: AUTH_ACTION_POLICY,
    invariants: {
      recoveryAutoUnlock: false,
      breakGlassSideEffectAllowed: false,
      breakGlassHumanGateRequired: true,
      phantomBaselineBehavior: false
    }
  };
}
