# ADR-002 - Router Cellular Identity Policy

| Field | Value |
|---|---|
| Status | `REJECTED_FOR_PRODUCT` / superseded by cellular inventory and terminal admission policy |
| Date | 2026-06-01 |
| Scope | Puli AX cellular identity, SIM lifecycle, terminal admission |
| Decision owner | Legal + CISO + Architect |

## Decision

SYLION product code must not implement public-network IMEI override, IMSI programming, Ki/OPc writing, TAC spoofing, modem unlock routines for identity mutation, or automated boot-time cellular identity rotation.

The supported implementation is:

1. Metadata-only cellular inventory for the router/modem/SIM.
2. Legal SIM/profile lifecycle records managed through inventory and provider contracts.
3. Terminal Admission Gate: Pixel + Puli AX + FIDO2 + router posture must match before the operator path is eligible for G1/G2 access.
4. Audit records contain policy decisions and hashes only, never raw identifiers or SIM secrets.

## Product Prohibitions

The following actions are permanently denied in product code:

- `imei_override`
- `imei_write`
- `imsi_programming_public_network`
- `ki_opc_write_public_network`
- `tac_spoofing`
- `modem_unlock_for_identity_mutation`
- `boot_time_cellular_identity_rotation`
- `public_network_identity_spoofing`

These prohibitions apply to all tiers, including PHANTOM and SOVEREIGN.

## Allowed Controls

- Read-only modem/SIM inventory with raw values redacted.
- Hashing of ICCID/IMEI/IMSI when the modem exposes them.
- Country/provider/APN/SIM status tracking.
- Legal provider rotation: moving an operator between approved providers, locations and SIM/profile records.
- Router posture checks: IPsec IKEv2, nftables kill switch, DNS tunnel-only, SSH key-only, WAN admin disabled.
- FIDO2/WebAuthn session unlock and step-up enforcement.

## Terminal Admission Gate

For production eligibility, the operator path requires:

1. Pixel terminal assigned to the operator.
2. Puli AX router assigned to the same operator.
3. Router package generated and posture validated.
4. Cellular radio disabled on Pixel; Pixel uses Wi-Fi only.
5. Router pairing evidence present.
6. FIDO2/WebAuthn user verification present.
7. No terminal operational data storage.

Failure of any condition blocks production eligibility and records an auditable deny decision.

## Lab Exception

RF lab work is out of product scope. Any future closed-lab modem research requires:

- isolated lab network or shielded RF environment,
- no public mobile network use,
- explicit legal approval,
- CISO approval,
- architect approval,
- separate private lab repository or evidence bundle,
- no product deployment path.

## Baseline Impact

Baseline SYLION remains:

- Thin Client: no operational data on terminal.
- Puli AX as access router.
- IPsec IKEv2 certificate-auth path to G1.
- G1/G2 split gateway.
- Firecracker/workload isolation.
- CDR on file ingress/egress.
- HSM-backed PKI when production HSM is ready.

## Required Tests

1. Product code denies every prohibited cellular identity action.
2. Cellular inventory redacts raw identifiers and stores only hashes/status metadata.
3. Terminal admission blocks G1 eligibility without Pixel + Puli AX + FIDO2.
4. Terminal admission blocks G1 eligibility when router posture is missing.
5. Terminal admission returns `productionEligible=true` only when all required evidence is present.
