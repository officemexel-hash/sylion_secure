# SYLION Secure

> **DRAFT** — ten plik jest pierwszą wersją publicznego README. Wersja końcowa wymaga zatwierdzenia Legal + CISO + Architect.

**Status:** development. **Not approved for production execution.** `productionExecutionAllowed = false`.

---

## English summary (TL;DR)

SYLION Secure is a control-plane platform for managing isolated, auditable communication infrastructure for tenants and operators. The system separates two scopes:

- **Baseline** (certifiable, in scope for ISO/SOC review path): admin API, admin web UI, provisioning planning, gated live cloud execution sandbox, audit hash chain, RBAC, WebAuthn step-up, CDR, PHANTOM governance metadata.
- **PHANTOM `[A]`** (autonomous, **outside** certifiable core): separate-track governance records only. PHANTOM cannot unlock baseline execution. No operational PHANTOM behavior runs in this codebase.

This repository is **published for transparency and review**. It is not a deployable production system. Production unlock requires multiple HUMAN GATE approvals listed in `docs/admin-panel-v2/55-step3-11-implementation-freeze-production-readiness.md`.

---

## Co to jest

SYLION Secure to **platforma control-plane** do zarządzania izolowaną, audytowalną infrastrukturą komunikacyjną dla tenantów i operatorów. Architektura opiera się na:

- **Thin Client** — brak danych operacyjnych na terminalu;
- **Zone model 0-5** — segmentacja sieci między baseline a tier-aware policy;
- **Split Gateway G1/G2** — separacja sieci od access broker;
- **Per-operator Firecracker microVM isolation** — workloads w izolowanych mikro-maszynach;
- **3 VPS per operator** — `G1`, `G2`, `WORKLOAD` zawsze separowane;
- **Mandatory CDR** dla file ingress/egress;
- **HSM-backed PKI** (target; obecnie metadata-only);
- **Audit hash chain** dla operacji wrażliwych;
- **WebAuthn + FIDO2** step-up dla akcji destruktywnych;
- **Gated live execution** — żadna mutacja prowidera bez przejścia 7 gate'ów (FIDO2, approval, allowlist, region, token presence, server cap, idempotency).

## Scope: Baseline vs PHANTOM `[A]`

| Obszar | Baseline (certifiable) | PHANTOM `[A]` (autonomous) |
|---|---|---|
| Implementation | tak, w `services/admin-api/` | **tylko governance records** — `services/admin-api/src/modules/phantom/` |
| Execution | gated, default-deny, real cloud sandbox | **zablokowane** — `executionAllowed=false` invariant |
| Compliance scope | ISO 27001 / SOC 2 / FedRAMP path | **poza** certifiable core |
| Production claim | "ready for metadata review" | **żadnego claimu certyfikacji** |
| Documents | Księga v3.4 §33 (baseline router, controls) | `SYLION_PHANTOM_v3.0.docx`, `[A]` annotated |

PHANTOM v3.0 zawiera analizy operacyjne (rotation, jurisdictional, RF mitigation) które są **legal-review zone** per `shared/references/legal-safety-boundaries.md`. Materiał ten jest publikowany dla transparency i audytu, **nie jako instrukcja wykonania**. Każda operacjonalizacja PHANTOM wymaga Legal + CISO + Architect + Compliance sign-off.

## Honest capability statement

Per `shared/references/legal-safety-boundaries.md` §"Honest Capability Statement":

> *SYLION nie twierdzi perfect invisibility ani impossible security. Twierdzi: constrained blast radius, isolation, encryption, auditable controls, explicitly documented residual risks.*

**Konkretne residual risks** udokumentowane w `SYLION-Analiza-Zagrozen-COMPLETE.pdf`:
- RF fingerprinting (PARADIS >99%) — nie do naprawy software-side, wymaga rotacji hardware
- Baseband proprietary (Quectel) — niezależny RTOS, niemożliwy pełen audyt
- Supply chain (Qualcomm/Quectel) — komponenty z jurysdykcji wywiadowczych
- Cellular metadata poza tunelem IPsec
- Cloud snapshot snapshotability (wszyscy główni IaaS providerzy)

## Bieżący stan implementacji

**Step 3.16** (`5b04e9f`, 2026-05-21):

- ✅ V1 frozen + V2 Steps 1, 2, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.13, 3.14, 3.15, 3.16 — *patrz `services/admin-api/IMPLEMENTATION_STATUS.md`*
- ✅ 77/77 testów passing
- ✅ Playwright regression z desktop + mobile artefaktami
- ✅ Real Hetzner sandbox operations (create / list / reconcile / rollback) — **gated, default-deny**
- ✅ `EnvSecretProvider` z zero plaintext leak (interface ready, vault swap pending)
- ✅ PHANTOM separation enforced w runtime (`record.resourceType !== "phantom"` exclusion)

**Co jest zablokowane do production:**

| Gate | Owner | Blocker |
|---|---|---|
| Provider mutation | SRE | Vault/KMS swap (interface ready, backend = env var) |
| Firecracker execution | Platform | Real microVM launch not implemented |
| HSM PKI | Security | Production HSM integration |
| Router firmware signing | Hardware | Pipeline missing — patrz `adr/ADR-router-phantom-001.md` |
| GrapheneOS image | Mobile | Real image build pipeline missing |
| PHANTOM v3.0 | Legal/CISO/Architect | Pozostaje `[A]`, nie unlocking baseline |

Status raportowany przez `services/admin-api/src/modules/release/releaseControlService.js`.

## Struktura repo

```
├── apps/admin-web/                  # Vanilla JS + HTML admin UI
├── services/admin-api/              # Node.js admin API (ESM, SQLite optional)
│   ├── src/modules/                 # 25 modułów domenowych
│   ├── src/lib/                     # errors, id, helpers
│   ├── src/storage/                 # in-memory + SQLite persistence
│   └── test/                        # 28 plików testowych (77 passing)
├── docs/
│   ├── admin-panel-v1/              # V1 freeze + planning pack
│   └── admin-panel-v2/              # V2 step-by-step freeze + masterplan + diagrams + test artifacts
├── adr/                             # Architecture Decision Records
├── shared/references/               # Normative references (gates, policy, boundaries)
├── skills/                          # SYLION skills definitions (Codex + Claude Code)
├── .claude/skills/                  # Project-installed Claude Code skills
├── SYLION Ksiega v3 4 FIXED.docx    # Normative system book (baseline)
├── SYLION-Analiza-Zagrozen-COMPLETE.pdf  # Threat model + R1-R18 recommendations
└── SYLION_PHANTOM_v3.0.docx         # PHANTOM [A] specification (separate track)
```

## Uruchomienie testów

```powershell
npm.cmd test                # 77 unit + e2e tests
npm.cmd run test:dashboard  # Playwright regression (writes screenshots to docs/)
```

PowerShell blokuje `npm.ps1` — używaj `npm.cmd`.

## Klucz architektoniczny: HUMAN GATE

Każda decyzja zmieniająca baseline, security scope, compliance lub legal posture musi przejść przez `HUMAN GATE REQUIRED` per `shared/references/human-gate-policy.md`. To dotyczy:

- promocji komponentu z `[E]/[O]/[R]/[A]` do baseline,
- zmiany `[N]` requirement,
- decyzji o hardware poniżej gate (`shared/references/hardware-gates.md`),
- zatwierdzenia operacji destruktywnych (four-eyes),
- każdej decyzji która zmienia jurisdictional / lawful-access exposure.

Lista skilli SYLION (które egzekwują te reguły) w `.claude/skills/`:

```
sylion-architecture-guardian
sylion-compliance-legal-guardrails
sylion-crypto-pki-pqc
sylion-doc-consistency-auditor
sylion-hardware-qualification
sylion-ops-sre-incident-response
sylion-router-openwrt-hardening
sylion-secure-implementation
sylion-skill-packager
sylion-threat-modeler
```

## Security disclosure

Patrz [`SECURITY.md`](./SECURITY.md). Krótko: prywatny GitHub Security Advisory dla raportów. Nie zgłaszaj wrażliwych podatności przez public issues.

## License

Patrz [`LICENSE`](./LICENSE). **Proprietary — All Rights Reserved** (placeholder DRAFT pending Legal final wording). Repo jest publiczne **wyłącznie dla transparency, audit, verification**; nie zezwala to na reuse, modyfikację, ani komercjalizację bez explicit licensji.

## Kontakt / contributing

Repo jest single-author work-in-progress (autor commitów: `SYLION Codex`). Pull requests nie są obecnie akceptowane — patrz roadmap w `docs/admin-panel-v2/`. Pytania architekturalne → przez GitHub Discussions (gdy włączone) lub kontakt zewnętrzny.

## Powiązane dokumenty

- [`shared/references/sylion-source-map.md`](./shared/references/sylion-source-map.md) — mapowanie źródeł, normatywność
- [`shared/references/hardware-gates.md`](./shared/references/hardware-gates.md) — gate'y hardware
- [`shared/references/human-gate-policy.md`](./shared/references/human-gate-policy.md) — kiedy HUMAN GATE
- [`shared/references/legal-safety-boundaries.md`](./shared/references/legal-safety-boundaries.md) — granice prawne
- [`adr/`](./adr/) — Architecture Decision Records
- [`docs/admin-panel-v2/55-step3-11-implementation-freeze-production-readiness.md`](./docs/admin-panel-v2/55-step3-11-implementation-freeze-production-readiness.md) — production readiness audit
