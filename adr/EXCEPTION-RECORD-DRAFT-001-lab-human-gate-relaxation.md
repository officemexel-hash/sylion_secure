# EXCEPTION RECORD (DRAFT) — 001 — Lab-testing human-gate relaxation request

| Field | Value |
|---|---|
| **Status** | `DRAFT — NOT APPROVED — NOT IN EFFECT` |
| **Type** | Human-gate exception request (per `shared/references/human-gate-policy.md`) |
| **Raised by** | Operator (verified) via agent session, 2026-05-29 |
| **Drafted by** | Claude (agent) — draft only; agent has NOT relaxed, removed, or bypassed any control |
| **Decision owners (ALL required)** | Legal counsel (per jurisdiction) • CISO • Architect • Compliance/Product |
| **Hard invariant in question** | `productionExecutionAllowed = false`; `routerIdentityOverride.executionAllowed = false`; PHANTOM `PROHIBITED_TERMS` runtime guard |

> This record exists because an operator requested removal of **all** human gates
> (including the PHANTOM track) "for lab testing, no matter what for." That request
> **cannot be actioned by an operator or an agent unilaterally** — by definition the
> control being removed is the control that gates its own removal. This draft routes the
> request to the four required owners. **Nothing here is in effect.**

---

## 1. What is requested

Operator asks to disable, for a stated lab/testing window, the SYLION human-gate controls,
explicitly "including the PHANTOM version," with unbounded purpose scope.

## 2. Why it is gated (not a matter of operator verification)

- `CLAUDE.md`: `productionExecutionAllowed = false` is a hard invariant; change requires
  explicit HUMAN GATE from Architect + CISO + Legal + Compliance.
- `human-gate-policy.md` §"When Human Gate Is Required": work touching PHANTOM, radio
  identity, baseline, compliance, or legal scope → gate; the model must not turn
  PHANTOM/autonomous content into baseline implementation steps.
- `phantomGovernanceService.js`: `PROHIBITED_TERMS` (incl. `imei`, `imsi`, `spoof`) and
  `executionAllowed:false`/`humanGateRequired:true` on every record; review board cannot
  reach `approved_placeholder` without all four owner acknowledgements + evidence.
- Operator verification authorizes ops/stream/IPsec work. It is **not** the four-party
  sign-off, and "lab/temporary" does not substitute for it — a scoped exception is itself
  a gated artifact (this record).

## 3. Material finding surfaced during this session (action required)

**Gated capability implemented ahead of its gate.** `ADR-002` (router cellular identity
override, IMEI/IMSI) states the module `services/admin-api/src/modules/routerIdentity/` is
"TBD, nie istnieje obecnie" and that implementation Phase B requires Phase A specs approved
by CISO + Architect + Legal, which in turn requires Phase 0 (per-jurisdiction Legal
opinion). As of 2026-05-29 the working tree contains, **untracked**:

```
infrastructure/puli-ax/identity-rotate.sh
infrastructure/puli-ax/config/sylion-identity-pool.conf
infrastructure/puli-ax/init.d/
scripts/puli-ax-modem-identity.mjs
scripts/puli-ax-install-identity-rotate.mjs
services/admin-api/src/modules/routerIdentity/
services/admin-api/test/router-identity.test.js
```

This indicates radio-identity override implementation has begun **before** ADR-002
Phase 0/Phase A sign-off. Per ADR-002 §7 ("Bez Phase 0 nigdy nie zaczyna się Phase A")
this is a process-gate deviation. **Recommended: CISO + Architect + Legal review the above
artifacts before any further work, test execution, or commit.** The agent did not run,
modify, advance, or commit these files.

## 4. Legality context (from ADR-002 §4, do not treat as legal advice)

IMEI/IMSI override is default-BLOCKED in every jurisdiction listed (UK Mobile Telephones
(Re-programming) Act 2002; US 18 U.S.C. §1029; DE, FR, PL, BR, SG, CH, LV equivalents).
Activation anywhere requires a per-jurisdiction Legal opinion as evidence. A blanket
"remove all gates for lab" request has no jurisdiction scoping and no Legal opinion
attached → cannot be approved as written.

## 5. Safe options for the owners

| # | Option | Notes |
|---|---|---|
| A | **Reject** the blanket request | Default. Gates remain. Lab work continues within existing controls. |
| B | Approve a **narrow, time-boxed lab exception** for a *specific non-prohibited* control, isolated network, `expiresAt` set, no PHANTOM/radio-identity scope | Use `phantomGovernanceService.createException` (rejects `executionRequested:true`). Must enumerate exactly which control, why, and the rollback. |
| C | Route the routerIdentity work through ADR-002 Phase 0→A | Per-jurisdiction Legal opinion first; then CISO+Architect+Legal spec approval. The only path that legitimizes the §3 artifacts. |

**Prohibited regardless of approval:** disabling `PROHIBITED_TERMS`, flipping
`productionExecutionAllowed`/`routerIdentityOverride.executionAllowed`, or removing the
four-eyes review board. These are not within an exception's power; they require amending
the baseline invariants themselves (a separate, higher gate).

## 5a. Proposed concrete scope (Option B — for owner approval)

A narrow, defensible scope an owner *could* approve for the current single-operator lab.
It relaxes only `[R]`-Recommended ceremony for non-prohibited, reversible work. It does
**not** — and cannot — touch any `[N]`-Normative invariant or prohibited capability.

### Boundary

| Dimension | Value |
|---|---|
| Tenant / operator | **Exactly one**: `tenant_43de340f-9f25-45ae-9063-10aec5e46c7e` / `op_1f2d06f7-56ae-4212-9d21-5a916045c050` (observed single-operator lab) |
| Hosting | Single provider (Hetzner) — current lab footprint only |
| Network | Lab path only (Pixel → Puli AX → G1 → G2 → AX102). No new internet-exposed surface. |
| Duration | **30 days** from approval; proposed `expiresAt = 2026-06-28` (revalidate or auto-revert) |
| Reversibility | Every action under this scope must be reversible and logged to WORM audit |

### What it WOULD relax (within owner discretion — all `[R]`/process)

| # | Relaxation | Basis |
|---|---|---|
| G-1 | Four-eyes (two-person) approval → **single approver** for *non-prohibited, reversible* router / network / workload config changes in the lab tenant | ADR-002 §3.2 R1 is `[R]` Recommended, not `[N]` |
| G-2 | PHANTOM lifecycle records (`capability`, `package`, `simulation`, `readiness`) may be created and exercised in **`simulation_only` / `review_only`** in the lab tenant without full board ceremony — **no execution, no `approved_placeholder`** | Simulation paths are already review-only by code |
| G-3 | Reduced evidence-bundle ceremony for **lab-only** test artifacts (still logged) | `requiredEvidenceTypes` warning, not blocker |

### What it does NOT and CANNOT relax (hard exclusions — restated)

- ❌ IMEI / IMSI / any radio-identity override (ADR-002) — remains BLOCKED even in lab
- ❌ `PROHIBITED_TERMS` runtime guard in `phantomGovernanceService.js`
- ❌ `productionExecutionAllowed = false` / `routerIdentityOverride.executionAllowed = false`
- ❌ `executionRequested: true` (code rejects it)
- ❌ Removal of the four-eyes review board as an institution (only per-change ceremony for `[R]` items is reduced, and only in the named lab tenant)
- ❌ Advancing / running / committing the untracked `routerIdentity/` & `identity-*` artifacts (see §3 — those need ADR-002 Phase 0→A regardless of this exception)

### Mapping to `createException(...)`

```js
createException({
  actor,                               // approving owner's actor
  scope: "Single-operator lab (tenant_43de340f / op_1f2d06f7), Hetzner footprint, lab network path only. Relax [R] four-eyes to single-approver for non-prohibited reversible config; allow PHANTOM lifecycle in simulation/review-only. NO radio-identity, NO execution, NO PROHIBITED_TERMS relaxation.",
  justification: "Time-boxed lab testing convenience for a single-operator isolated setup; all actions reversible and WORM-audited.",
  legalOwner: "<Legal counsel>",
  cisoOwner: "<CISO>",
  complianceOwner: "<Compliance/Product>",
  evidenceRefs: ["EXCEPTION-RECORD-DRAFT-001", "ADR-002", "human-gate-policy.md"],
  status: "legal_review",
  executionRequested: false,           // MUST stay false — code throws otherwise
  expiresAt: "2026-06-28T00:00:00.000Z",
  correlationId
})
```

> Note: even with all owners signing, the resulting record carries
> `humanGateRequired:true`, `executionAllowed:false`, `executionEnabled:false`. The
> exception buys *reduced ceremony for `[R]` lab work*, not execution of gated capability.

## 6. Sign-off (none recorded — draft)

| Role | Name | Date | Decision | Comment |
|---|---|---|---|---|
| Legal counsel (per jurisdiction) | ____ | ____ | ☐ approve ☐ reject ☐ changes | |
| CISO | ____ | ____ | ☐ approve ☐ reject ☐ changes | |
| Architect | ____ | ____ | ☐ approve ☐ reject ☐ changes | |
| Compliance/Product | ____ | ____ | ☐ approve ☐ reject ☐ changes | |

---

### Appendix — what the agent DID do this session (all in-bounds)

- Diagnosed and fixed the Pixel→G1 path on the Puli AX router: repaired a `firewall.user`
  shell-syntax error that blocked the SNAT/MSS rules; set the include to run on reload.
  Verified end-to-end from the Pixel (ping 0% loss, tunnel counters advanced). Captured in
  `.deploy/puli-ax-ipsec-lab/` (gitignored).
- Fixed a stale identity check in `scripts/verify-pixel-g1-g2-native-path.mjs` so it
  recognizes the router-terminated tunnel (`router.OP-001`) and stops false-reporting the
  G1 leg as down. (IPsec identity only — no radio-identity content.)
- Refused: removing/relaxing any human gate, the PHANTOM controls, the hard invariants,
  and verifying/advancing/running the IMEI/IMSI override implementation.
