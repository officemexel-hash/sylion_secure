# SYLION Source Map

Use this reference when a SYLION skill needs to ground a decision in the current project documents.

## Source Documents

- `SYLION Ksiega v3 4 FIXED.docx`: normative system book. Treat it as the highest project reference for baseline requirements, but do not treat it as infallible when hardware facts, risk analysis, or another source exposes a contradiction.
- `SYLION-Analiza-Zagrozen-COMPLETE.pdf`: threat and transport assessment. Treat it as the current threat model input, especially for terminal path, RF fingerprinting, Starlink, residual risks, and recommendations R1-R18.
- `SYLION_PHANTOM_v3.0.docx`: autonomous PHANTOM specification. Treat it as outside the certifiable SYLION core. PHANTOM can inform threat modeling and risk boundaries, but it must not silently become baseline product behavior.

## Normativity Model

- `[N] Normative`: mandatory for production baseline. Missing any `[N] requirement blocks certification unless there is a formal approved exception.
- `[R] Recommended`: expected unless there is a documented architectural justification and approved deviation.
- `[O] Optional`: allowed by policy/tier, not baseline by default.
- `[E] Experimental`: R&D only. Do not put into production.
- `[A] Autonomous`: outside certifiable core. Requires explicit legal/operational mandate and must be isolated from baseline claims.

## Core Baseline Signals

The SYLION baseline centers on:

- Thin Client / no data on terminal.
- Zone model 0-5.
- Split Gateway: G1 network gateway and G2 access broker.
- IPsec IKEv2 rather than WireGuard for FIPS/CNSA-aligned transport.
- Matrix as communication core, with compatibility workloads degraded or isolated.
- Firecracker microVM isolation per operator.
- Microsegmentation per operator.
- HSM-backed PKI.
- CDR for file transfer.
- Immutable infrastructure.
- Observable, auditable operations.

## Router Conflict To Preserve

The documents currently contain a material router inconsistency:

- The system book chapter 33 names GL-iNet Beryl AX / GL-MT3000 as the reference access router and defines minimum alternative-router requirements including OpenWrt 23.05+, strongSwan, AES acceleration, and RAM >= 256 MB with 512 MB recommended.
- The threat assessment still models GL.iNet Mudi v2 / GL-E750V2 as the external mobile router in the terminal signal path.
- The component index of the system book still mentions "Mudi v2 Router (GL-E750V2)" even though chapter 33 uses Beryl AX / MT-3000.
- GL-E750V2 / Mudi v2 class hardware is below the system-book RAM gate and is not acceptable as the baseline router without a formal exception and a reduced scope.

Any skill that touches router design, terminal architecture, threat model, procurement, OpenWrt firmware, or document updates must flag this inconsistency.

## Current Router Baseline

Treat GL-iNet Beryl AX / GL-MT3000, or a validated equivalent, as the working baseline until the book is formally changed.

Alternative router approval must pass:

- OpenWrt 23.05+ support.
- strongSwan/IPsec IKEv2 support.
- RAM >= 256 MB absolute minimum; 512 MB recommended.
- Sufficient flash for hardened OpenWrt, strongSwan, nftables, logs, config overlay, rollback/update safety, and future packages.
- AES acceleration or demonstrated IPsec throughput.
- Kill switch support at firewall level.
- Manageable firmware lifecycle and signed update process.

## Required Behavior When Sources Conflict

When sources disagree:

1. State the conflict explicitly.
2. Prefer `[N] requirements over descriptive or legacy text.
3. Check external or hardware facts if they determine feasibility.
4. Propose a book update, ADR, or exception record rather than silently choosing.
5. Separate baseline product decisions from PHANTOM `[A]` decisions.
6. If the conflict affects baseline, security, compliance, legal scope, or hardware approval, trigger `HUMAN GATE REQUIRED` using `human-gate-policy.md`.
