# ADR-002 — Router cellular identity override (IMEI/IMSI) — architektura kontraktu firmware

| Pole | Wartość |
|---|---|
| **Status** | `DECISION PENDING` — DRAFT, **Legal-gated**, wymaga HUMAN GATE z udziałem prawnym |
| **Data** | 2026-05-21 |
| **Autor draftu** | Claude (audit agent) |
| **Wymagane podpisy** | **Legal counsel (per jurysdykcja)** • CISO • Architect • Hardware Lead |
| **Scope** | Architektura **interfejsu firmware** dla optional router-side cellular identity override w profilu PHANTOM `[A]`. **NIE jest specyfikacją operacyjną.** |
| **Z czego korzysta** | `PHANTOM v3.0` §7.3, §8, §10 (treść autorytatywna pozostaje w dokumencie source, nie w tym ADR) • `Analiza Zagrożeń` §11 R12, R13 + krytyczna nota prawna §11 |
| **Out of scope (NIE w tym ADR)** | Phone-IMEI manipulation (Pixel baseband w airplane mode per Analiza R1) • Operational AT command syntax • NV memory layouts • TAC pool sourcing • Specific carrier-side detection bypass • Jurisdictional evasion advice |
| **Powiązane ADR** | ADR-router-phantom-001 REVISED §"Out of scope" wskazuje ten ADR jako follow-up • ADR-router-baseline-002 §4 BoM (Puli AX + alternatywy) • ADR-vault-adapter-001 (key custody dla operator policy auth) • ADR-worm-audit-001 (audit trail każdej zmiany) |

---

## ⚠️ HUMAN GATE — przeczytaj przed czytaniem reszty

Ten ADR opisuje **architecture interface contract** dla funkcjonalności która:

1. **Jest legal-review zone** per `shared/references/legal-safety-boundaries.md` §"Restricted Work"
2. **Jest opisana jako "technicznie możliwa — prawnie warunkowa"** w PHANTOM v3.0 §10
3. **Jest nielegalna bez explicit mandate** w UK (Mobile Telephones Re-programming Act 2002), USA (18 U.S.C. §1029), Latvia (Criminal Code §244), Singapore (Computer Misuse Act), Brazil (Lei 13.064/2014) i większości jurysdykcji UE pod implementacjami GSMA recommendations + krajowymi Computer Misuse Acts
4. **Jest dostępna tylko w PHANTOM `[A]` profile** — outside certifiable SYLION baseline core
5. **Nigdy nie może być włączona bez per-jurisdiction Legal opinion + CISO + Architect sign-off**

Ten dokument **nie** zawiera:
- Operational steps how to perform IMEI/IMSI override
- AT command syntax
- NV memory write recipes
- Pool sourcing strategies
- Evasion of lawful intercept guidance

Ten dokument **zawiera tylko**:
- Architectural interface contract (jak komponent **wyglądałby** w SYLION jeśli kiedykolwiek byłby aktywowany)
- Invariants i gates (co MUSI być prawdą żeby komponent mógł działać)
- Audit + recovery surface
- Per-jurisdiction policy plumbing
- Test harness reference (test cases T14-T16 z ADR-router-phantom-001 §9)

**Każda implementacja tego ADR wymaga oddzielnego implementation plan z Legal sign-off per docelowa jurysdykcja deployment.**

---

## 1. Kontekst

### 1.1 Co adresuje

PHANTOM v3.0 §7.3 opisuje opcjonalne router-side override cellular identity (IMEI) i §8 opisuje rotację SIM (przekładającą się na IMSI variation) jako część autonomous PHANTOM `[A]` operational profile.

ADR-router-phantom-001 REVISED §"Out of scope" explicit wskazuje że ta funkcjonalność jest **out of scope tamtego ADR**, ale wymaga osobnego dokumentu architectural. Ten ADR jest tym dokumentem.

### 1.2 Czego NIE adresuje

| Co | Dlaczego nie |
|---|---|
| Phone IMEI override (Pixel baseband) | Analiza R1: Pixel zawsze airplane mode → phone IMEI nigdy nie jest transmitted. Out of scope architekturalnie |
| Operational HOW | Skill `sylion-compliance-legal-guardrails` zabrania "turning legal-review content into implementation steps". HOW żyje w PHANTOM v3.0 §7.3 (treść autorytatywna), nie tutaj |
| Bypass of lawful intercept controls | `legal-safety-boundaries.md` §"Restricted Work" explicit forbid |
| TAC pool ethics | Per Legal review per jurysdykcja — nie model decision |

### 1.3 Why this exists at all

Jeśli SYLION nigdy nie aktywuje `phantom-a` profile, **ten ADR pozostaje nigdy zaimplementowany** i to jest OK. Istnieje żeby:

- Zapewnić że gdy/jeśli aktywacja nastąpi, jest udokumentowany audit-ready interface
- Zdefiniować invariants które MUSZĄ być spełnione (default-deny, per-jurisdiction gate, audit trail, brick recovery)
- Wyraźnie oddzielić **architecture** (publiczne, audytowalne) od **operations** (Legal-gated, source dokumenty PHANTOM v3.0)

## 2. Decyzja (architectural-level)

### 2.1 Komponent

W kodzie SYLION (jeśli kiedykolwiek implementowany) ADR-002 wprowadza:

- `RouterIdentityOverrideService` — service module pod `services/admin-api/src/modules/routerIdentity/` (TBD, nie istnieje obecnie)
- `OperatorIdentityPolicy` — per-operator policy record z statusem `disabled_by_default`, `enabled_under_legal_mandate`, `blocked`
- Adapter interface `IdentityOverrideAdapter` — abstrakcja over modem-specific implementation (Quectel adapter, future Sierra Wireless adapter, etc.)
- Audit hook do `ADR-worm-audit-001` — każda zmiana identity zapisywana w hardened audit chain
- Test harness binding do T14, T15, T16 z ADR-router-phantom-001 §9

### 2.2 NIE w decyzji

- Konkretna implementacja adaptera (Quectel)
- Konkretny modem AT command set
- NV memory layout / backup format
- Pool data structures
- UI exposure (operator widzi tylko status, nie żadne raw identity values)

### 2.3 Default invariant

```
routerIdentityOverride.executionAllowed = false  (twardy invariant w baseline)
operatorIdentityPolicy.status = "disabled_by_default"  (default per operator)
```

Aktywacja `enabled_under_legal_mandate` wymaga:
1. Per-jurisdiction Legal opinion attached as policy evidence
2. CISO sign-off recorded w audit
3. Architect sign-off recorded w audit
4. Subscription tier `SOVEREIGN` lub explicit STATE customer contract
5. PHANTOM `[A]` track activation explicit

## 3. Wymagania `[N]/[R]/[O]`

### 3.1 Normative (`[N]`)

| # | Wymóg |
|---|---|
| N1 | Default-deny: każdy operator startuje z `identityPolicy.status = "disabled_by_default"` |
| N2 | Per-jurisdiction Legal opinion evidence wymagana jako pre-condition jakiejkolwiek aktywacji |
| N3 | Każda zmiana identity audytowana w hardened audit chain (per ADR-worm-audit-001) z fields: timestamp, operator_id, jurisdiction_policy_id, evidence_refs, signed_by — **bez raw identity values** w plain audit log |
| N4 | Brick-recovery procedure must exist before any production activation (pre-write NV backup, RMA path, JTAG fallback documentation) |
| N5 | Per-jurisdiction policy gate enforced runtime (request bez current Legal evidence → reject + audit) |
| N6 | PHANTOM `[A]` track activation marker — komponent nie może być włączony w baseline operator |
| N7 | Operator UI nie eksponuje raw identity values — tylko status `disabled/enabled/blocked` + last change audit reference |
| N8 | Inventory schema obejmuje `identityOverrideStatus` field per device |
| N9 | Subscription tier policy: tylko `SOVEREIGN` lub explicit STATE contract może mieć `enabled_under_legal_mandate` |
| N10 | Test harness T14, T15, T16 z ADR-router-phantom-001 §9 musi przejść w lab przed jakąkolwiek production aktywacją |

### 3.2 Recommended (`[R]`)

| # | Wymóg |
|---|---|
| R1 | Two-person approval (four-eyes) dla każdej zmiany identity policy (per `sylion-ops-sre-incident-response` skill) |
| R2 | Auto-revert na default po N dni jeśli Legal evidence wygasł |
| R3 | Per-deployment runbook explicit przed activate, sign-off przez Customer Success + Legal |
| R4 | Audit alert do CISO przy każdej aktywacji `enabled_under_legal_mandate` |
| R5 | Periodic Legal opinion refresh — co 12 mc revalidate per jurysdykcja |
| R6 | Customer agreement explicit acknowledgement of `[A]` status + non-baseline scope |

### 3.3 Optional (`[O]`)

| # | Wymóg |
|---|---|
| O1 | Hardware tamper-evident on router (wykrywanie unauthorized identity change attempt) — wymaga STATE tier hardware |
| O2 | Customer-side Legal opinion submission via signed evidence bundle (per ADR-worm-audit-001 evidence pattern) |

## 4. Per-jurisdiction legality matrix (do uzupełnienia przez Legal)

| Jurysdykcja | Podstawa prawna anti-IMEI-change | Status SYLION deployment |
|---|---|---|
| 🇬🇧 UK | Mobile Telephones (Re-programming) Act 2002 — criminal offence | **Default BLOCKED** — Legal opinion required |
| 🇺🇸 USA | 18 U.S.C. §1029(a)(9) — access device fraud | **Default BLOCKED** — federal review required |
| 🇩🇪 DE | StGB §202c (Vorbereiten des Ausspähens) + TKG | **Default BLOCKED** — counsel review required |
| 🇫🇷 FR | Code pénal Art. 323-3-1 | **Default BLOCKED** |
| 🇵🇱 PL | KK Art. 269b interpretacyjnie | **Default BLOCKED** |
| 🇧🇷 BR | Lei 13.064/2014 | **Default BLOCKED** |
| 🇸🇬 SG | Computer Misuse Act §4 | **Default BLOCKED** |
| 🇨🇭 CH | StGB Art. 144bis (data damage) | **Default BLOCKED** |
| 🇱🇻 LV | Criminal Code §244 | **Default BLOCKED** |

**Default everywhere = BLOCKED.** Tabela jest do uzupełnienia przez counsel per pojedyncza jurysdykcja deployment, z explicit dokumentem `legal-opinion-<jurisdiction>-<date>.pdf` jako evidence.

## 5. Architectural surface (high-level)

### 5.1 Adapter interface (abstrakcja)

```
interface IdentityOverrideAdapter {
  validateCapability(deviceId, correlationId): CapabilityReport
  // Returns: { modemDetected, identityWriteSupported, brickRiskLevel }
  // Does NOT execute any change. Read-only capability probe.

  proposeChange(policy, evidenceRefs, correlationId): ChangeProposal
  // Returns: { proposalId, expectedAuditFields, gatesRequired[], status }
  // Does NOT execute. Generates proposal for sign-off workflow.

  // executeChange() — DELIBERATELY NOT in interface at this layer.
  // Execution requires runtime-only adapter (out-of-tree, Legal-gated)
  // that ingests an approved proposal + two-person signature.
}
```

### 5.2 Policy lifecycle

```
disabled_by_default
    ↓ (legal opinion + CISO approval + architect approval)
proposed_for_activation
    ↓ (sign-off complete, customer agreement)
enabled_under_legal_mandate
    ↓ (12 mc timer expiry or anomaly)
review_required
    ↓ (revalidation pass)
enabled_under_legal_mandate (renewed)
    ↓ (revalidation fail or revocation)
blocked
```

### 5.3 Audit fields (per ADR-worm-audit-001 HMAC chain)

Każdy event:

```
{
  eventId: UUID,
  resourceType: "router_identity_policy",
  action: "policy_change" | "proposal_create" | "review_required" | ...
  operatorId: opaque-id (no PII),
  jurisdictionPolicyRef: hash-ref do legal-opinion bundle,
  evidenceBundleRef: hash-ref do attached evidence,
  signedByCiso: signature-ref,
  signedByArchitect: signature-ref,
  signedByLegal: signature-ref,
  // raw identity values NEVER in audit chain
  identityValueHash: sha256(value + per-tenant-salt),  // for correlation only
  previousPolicyHash: parent-chain-hash,
  hmac: ...  // per ADR-worm-audit-001
}
```

### 5.4 Brick recovery

| Failure mode | Recovery |
|---|---|
| NV write nie powiódł się midway | Adapter MUST capture pre-write NV dump as evidence; rollback via dump replay |
| Modem unresponsive po write | Documented JTAG recovery path per modem SKU + vendor RMA escalation |
| Audit chain inconsistency post-change | Block further changes, alert CISO, manual review |
| Customer revoke Legal mandate | Auto-trigger revert do disabled_by_default + audit + customer notification |

### 5.5 Test harness binding (per ADR-router-phantom-001 §9)

T14, T15, T16 są testy z tamtego ADR. Tutaj kontekst:

- **T14 eSIM profile rotation via lpac CLI** — wymaga functioning eSIM Management w GL OS. Sprawdza że rotation profile odbywa się bez identity-write w innym module
- **T15 IMEI override persist + revert** — gated test, **tylko w lab**, wymaga pre-write NV backup. **NIE jest production deployment** test
- **T16 Anti-tamper response** — sprawdza że unauthorized modification attempt jest detected + audited

Wszystkie three testy są lab-only, nigdy nie odpalane na production-deployed device.

## 6. Konsekwencje

### 6.1 Pozytywne (gdy aktywowany w odpowiednich okolicznościach)

- PHANTOM `[A]` profile możliwy w sankcjonowanych operacjach z explicit Legal mandate
- Audit-ready trail per change (forensic capability nawet w czasie post-mortem investigation)
- Multi-jurisdiction support możliwy z per-jurisdiction policy granularity
- Customer BYO Legal opinion path

### 6.2 Negatywne / residual risks

- **Cały koncept jest legal-review zone** — każde naruszenie default-deny invariants = potencjalna criminal liability
- Brick risk on NV write — wymaga vendor RMA path
- Customer mismanaging activation może wpaść w criminal liability w jurysdykcji bez mandate
- Implementation effort znaczny (adapter + policy + audit + recovery + test harness) i Legal cost
- Public visibility ADR-002 (repo jest public) może być interpretowany niekorzystnie przez observers — wymaga że README + LICENSE jasno markują scope (✅ done in Phase 0)

### 6.3 Architecture / baseline impact

- **Nie zmienia** baseline (productionExecutionAllowed=false invariant zachowany)
- `phantom-a` profile per ADR-router-phantom-001 §5 jest single home dla tej funkcjonalności
- Wymaga ADR-vault-adapter-001 implementation (key custody dla policy signing)
- Wymaga ADR-worm-audit-001 implementation (forge-resistant audit)

### 6.4 Compliance

- `phantom-a` profile pozostaje **outside** certifiable scope (per `legal-safety-boundaries.md`)
- ISO 27001 / SOC 2 / FedRAMP path nie obejmuje tego ADR
- Customer-facing marketing **nie może** wspominać IMEI/IMSI capabilities — ten ADR jest internal-architecture
- Public repo widzi ten ADR ale **bez operational details** — `PROHIBITED_TERMS` runtime guard nadal w mocy w `phantomGovernanceService`

## 7. Implementation plan (CONDITIONAL — tylko po Legal sign-off)

⚠️ Wszystkie poniższe phases są **conditional** — nie startują dopóki Legal counsel nie zatwierdzi minimum jednej target jurisdiction.

| Phase | Pre-conditions | Owner | Deliverable |
|---|---|---|---|
| 0 | Legal opinion `legal-opinion-<jur>-<date>.pdf` for at least one target jurisdiction | Legal | Evidence bundle |
| A | Phase 0 done. ADR-vault-adapter-001 Phase A done. ADR-worm-audit-001 Phase A done. | Architect + Security | Detail-level implementation spec (internal doc, nie ten ADR) |
| B | Phase A specs approved by CISO + Architect + Legal | Codex / Platform | `RouterIdentityOverrideService` module implementacja (interface-level) |
| C | Phase B implementation passes T14-T16 in lab | QA + Hardware Lead | Test report + CISO sign-off |
| D | Per-customer activation runbook approved + customer contract amended | Customer Success + Legal | Per-deployment runbook |
| E | Production activation per single customer per single jurisdiction | Operations + Legal | Live deployment + 30-day shadow audit |

**Bez Phase 0 nigdy nie zaczyna się Phase A.** Phase 0 to **policy decision**, nie technical decision.

## 8. HUMAN GATE / Open items

1. **Czy jakikolwiek customer wymaga `phantom-a` profile?** — jeśli nie, ten ADR pozostaje DECISION PENDING bez aktywacji. To OK.
2. **Per-jurisdiction Legal opinion sources** — kto je generuje, kto reviewuje, retention policy
3. **HSM key custody dla policy signing** — depends on ADR-vault-adapter-001 Phase B
4. **Brick recovery vendor relationships** — RMA paths z GL.iNet, Quectel — czy są zabezpieczone?
5. **Customer agreement template** — Legal draft wymagany przed jakąkolwiek aktywacją
6. **Auto-revert timer (R2)** — proponowane 12 mc; czy akceptowalne czy krótsze?
7. **Public repo visibility ADR-002** — czy ten ADR powinien być w private fork zamiast main? Lub redacted? Per F-12 user już zadeklarował świadomą publikację Legal/CISO, ale ADR-002 jest większą eskalacją niż PHANTOM v3.0 binary doc

## 9. Sign-off

| Rola | Nazwisko | Data | Decyzja | Komentarz |
|---|---|---|---|---|
| Legal counsel (per target jurysdykcja) | _________ | ____ | ☐ approve ☐ reject ☐ changes | **wymaga osobnego dokumentu evidence per kraj** |
| CISO | _________ | ____ | ☐ approve ☐ reject ☐ changes | |
| Architect | _________ | ____ | ☐ approve ☐ reject ☐ changes | |
| Hardware Lead | _________ | ____ | ☐ approve ☐ reject ☐ changes | |

ADR staje się `ACCEPTED-CONDITIONAL` po wszystkich approve + co najmniej jedna konkretna Legal opinion w evidence. Implementation Phase A nie startuje dopóki to nie nastąpi.

---

## Appendix A — Źródła

Treść autorytatywna (operational):
- `SYLION_PHANTOM_v3.0.docx` §7.3 (router-side IMEI override description), §8 (SIM/eSIM pool), §10 (legal-conditional framing)
- `SYLION-Analiza-Zagrozen-COMPLETE.pdf` §11 R12 (jurisdictional rotation), R13 (fizyczne SIM zamiast eSIM), krytyczna nota prawna §11

Treść normatywna (boundaries):
- [`shared/references/legal-safety-boundaries.md`](../shared/references/legal-safety-boundaries.md) §"Restricted Work"
- [`shared/references/human-gate-policy.md`](../shared/references/human-gate-policy.md)
- [`shared/references/hardware-gates.md`](../shared/references/hardware-gates.md)

Powiązane ADR:
- [`adr/ADR-router-phantom-001.md`](./ADR-router-phantom-001.md) REVISED §"Out of scope" (designuje ten ADR jako follow-up)
- [`adr/ADR-router-baseline-002.md`](./ADR-router-baseline-002.md) §4 BoM (hardware platform)
- [`adr/ADR-vault-adapter-001.md`](./ADR-vault-adapter-001.md) (key custody)
- [`adr/ADR-worm-audit-001.md`](./ADR-worm-audit-001.md) (forge-resistant audit)

Code references:
- `services/admin-api/src/modules/phantom/phantomGovernanceService.js` — PROHIBITED_TERMS runtime guard (zostaje active independent of this ADR)
- `services/admin-api/src/modules/router/routerReadinessService.js` — istnieje (Step 3.30), ale **nie zawiera** override capability — to celowo separate component

## Appendix B — What this ADR explicitly does NOT contain

Aby uniknąć nieporozumień, ten ADR celowo NIE zawiera:

1. AT command syntax dla jakiegokolwiek modemu (Quectel, Sierra, etc.)
2. NV memory layout / dump format
3. TAC code allocation strategies
4. Carrier-side detection bypass techniques
5. Operational rotation cadence (per PHANTOM-6/12/24 — tamto żyje w PHANTOM v3.0 + ADR-router-baseline-002 §3.4)
6. Specific persistence vs ephemerality recipes
7. Multi-IMEI pool sourcing
8. Operator OPSEC checklist for using `phantom-a` profile

Te tematy żyją w:
- PHANTOM v3.0 source dokument (Legal-reviewed before publication)
- Per-deployment internal runbooks (Legal-gated)
- Customer-specific contracts

**Ten ADR jest mostem między source dokumenty a kod — architectural contract, nie operational guide.**
