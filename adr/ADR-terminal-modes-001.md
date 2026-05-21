# ADR-terminal-modes-001 — Dwa tryby terminala operatorskiego: Pixel + laptop web

| Pole | Wartość |
|---|---|
| **Status** | `PROPOSED` — DRAFT, wymaga HUMAN GATE |
| **Data** | 2026-05-21 |
| **Autor draftu** | Claude (audit agent) |
| **Wymagane podpisy** | Architect • CISO • Security |
| **Scope** | Definicja terminal modes dla operatora SYLION oraz `/operator` portal |
| **Powiązane** | PHANTOM v3.0 §1.1 (Pixel renderer) • Księga v3.4 (Thin Client invariant) • ADR-router-phantom-001 REVISED (Puli AX router) • F-1 routing decision |

---

## 1. Kontekst

Obecna architektura (Księga + PHANTOM v3.0 §1) definiuje **terminal = Pixel + GrapheneOS w trybie airplane mode**, podłączony do routera operatora przez WiFi. Pixel renderuje piksele z G2 access broker, brak operational data lokalnie.

Wymagania biznesowe wymagają **drugiego typu terminala**: laptop z przeglądarką (web thin client). Powody:

- Mobilność operatora w środowisku gdzie smartfon nie jest narzędziem (np. analytical workflow z większym ekranem)
- Backup terminal jeśli Pixel niedostępny
- Onboarding workflow zanim Pixel zostanie dostarczony / setup
- Wsparcie use cases gdzie keyboard/mouse są wymagane

**Wymagania:**

1. Zachować Thin Client invariant (no operational data on terminal) — twarda granica per `sylion-architecture-guardian` skill
2. Oba terminale → router IPsec tunnel → G1 (per `gate_router_puli_ax` + tunnel infrastruktura)
3. Osobny portal `/operator` (różny od admin panelu `/admin`)
4. UI placeholders dla FIDO2 + HSM konfiguracji (functionality w późniejszej fazie)

## 2. Decyzja

**Dwa tryby terminala obsługiwane przez SYLION baseline:**

| # | Mode | Klient | Hardware | Posture base |
|---|---|---|---|---|
| **M1** | **Pixel native** | GrapheneOS app (TBD) | Pixel 8/8a/9/9a/10 z GrapheneOS | Verified Boot + Titan M2 attestation |
| **M2** | **Laptop web** | Browser (Vanadium / Chromium / Firefox) | Windows/macOS/Linux laptop | OS posture API + browser version + WebAuthn |

**Operator portal:** `/operator/*` route, oddzielny od `/admin/*`, serwowany przez admin-api z `apps/operator-web/`.

**Thin Client invariant preserved w obu mode'ach:**
- Mode M1: GrapheneOS app nie zapisuje operational data lokalnie; piksele renderowane z G2
- Mode M2: Browser pracuje w PWA mode z `Service-Worker: no-cache`, `Storage-Quota: 0` enforced server-side, brak download permissions, brak clipboard write, brak screenshot API access

## 3. Rozważone alternatywy

| # | Alternatywa | Wynik | Uzasadnienie |
|---|---|---|---|
| A1 | Tylko Pixel (status quo) | rejected | Pomija use cases które wymagają laptop input/screen |
| A2 | Pixel + native Electron/Tauri app na laptop | considered, deferred | Wymaga distribution pipeline (signed installers per OS), więcej kodu, attack surface (auto-update, IPC). Browser daje 80% benefit za 20% kosztu. Może wrócić w Phase 3 dla wyższego tiera |
| A3 | Pixel + laptop browser + tablet (iPad/Android) | rejected MVP | Browser na tablecie działa "for free" jako podzbiór M2. iPad jako osobny mode nie wnosi enough vs surface koszt |
| A4 | Browser-only (no Pixel) | rejected | Pixel + GrapheneOS jest **strategic capability** per PHANTOM v3.0 §1.1 (Verified Boot, Titan M2, BFU/AFU resistance per Analiza §4.4). Bez Pixela tracimy core threat model strength |

## 4. Architecture

### 4.1 Wspólne (oba modes)

```
Operator terminal (M1 or M2)
    ↓ WiFi do routera operatora (per ADR-router-phantom-001: Puli AX)
Puli AX router
    ↓ IPsec IKEu2 tunnel (cert-auth, AES-256-GCM)
G1 network gateway (per Księga §X)
    ↓ internal-only routing
G2 access broker (per Księga §Y)
    ↓ pixel stream (M1) lub web app session (M2)
Operator workload (per Firecracker microVM in G1)
```

Wspólny stack:
- Router establishes IPsec tunnel (zarządzany przez router firmware per ADR-router-baseline-002)
- Cert-based mutual auth: operator FIDO2 (after enrollment phase) + service cert
- WebAuthn lub cert-based device identity

### 4.2 Mode M1 — Pixel native

- Pixel + GrapheneOS app `SYLION Terminal` (TBD, separate ADR-002 / build pipeline)
- Connection: GrapheneOS strongSwan client lub embedded VPN profile (per app)
- Renderer: WebRTC video stream lub VNC-like protocol z G2 access broker
- Input: touchscreen + soft keyboard (with constrained clipboard, no copy-out)
- Storage: ramfs only (per PHANTOM §5.2 pattern dla terminal app)
- Posture: Verified Boot status + attestation report z Titan M2 per Auditor app schema

### 4.3 Mode M2 — Laptop web

- Browser: Vanadium recommended, Chromium-based fallback, Firefox fallback
- Connection: laptop łączy się do WiFi routera operatora (Puli AX). Router IPsec tunnel obejmuje cały traffic laptopa do G2
- Renderer: WebRTC video stream w `<video>` element + `RTCDataChannel` dla input events
- Input: keyboard + mouse + touchpad
- Storage policy enforced server-side:
  - `Cache-Control: no-store`
  - `Service-Worker` disallowed (CSP) lub minimal SW dla offline indicator only
  - IndexedDB quota = 0 enforced
  - `Storage-Quota` API blocked
  - localStorage / sessionStorage emptied on session end via beforeunload + server-side cookie revoke
- Posture validation:
  - OS minimum: Windows 11 22H2+ / macOS 13+ / Ubuntu 22.04+ z secure boot + FDE
  - Browser minimum version (rolling, last 2 major releases)
  - WebAuthn capability check
  - Operating env signal: HTTPS, secure context, no proxy interception (HSTS preload)
- No-screenshot/no-clipboard hint via UI (cannot fully enforce w browser, ale operator policy + audit signal)

### 4.4 Operator portal `/operator/*`

```
/operator/login         (FIDO2 + fallback per phase)
/operator/dashboard     (status, alerts)
/operator/devices       (their Pixel, their laptop terminal record)
/operator/workloads     (their G1 microVMs status)
/operator/vpn-status    (router connection, IPsec tunnel state)
/operator/audit         (own actions only — scoped read)
/operator/settings/fido2 (FIDO2 key management — placeholder UI now, functional later)
/operator/settings/hsm   (HSM key reference — placeholder UI now, functional later)
/operator/subscription   (tier, quota usage, billing state — read-only)
```

Separation z `/admin/*`:
- RBAC: operator role ma access tylko do swoich resources (per `rbacService` policy)
- Frontend: oddzielny bundle `apps/operator-web/` (mały, fokus na operator workflow)
- Backend: te same endpoints w admin-api ale guard przez operator-scoped middleware (filter by operatorId)

## 5. Wymagania `[N]/[R]/[O]`

### 5.1 Normative (`[N]`)

- N1 Thin Client invariant: oba modes muszą blokować operational data persistence na terminalu
- N2 Cert-based auth: oba modes używają cert-based device + user auth (no password-only)
- N3 IPsec IKEv2: wszystkie terminal connections idą przez router IPsec tunnel
- N4 Audit: każde operator action audytowane w hash chain (per ADR-worm-audit-001)
- N5 FIDO2 step-up: destruktywne akcje wymagają fresh FIDO2 challenge (per Step 3.2)
- N6 RBAC isolation: operator widzi tylko swoje resources w `/operator/*`

### 5.2 Recommended (`[R]`)

- R1 Vanadium browser preferred dla mode M2 (best privacy defaults)
- R2 Laptop FDE enforced via posture check (deny enrollment if FDE off)
- R3 OS-level firewall recommended dla mode M2 (block non-tunnel egress)
- R4 Periodic posture re-validation co 24h
- R5 Auto-logout po N minutach inactivity (per subscription tier)

### 5.3 Optional (`[O]`)

- O1 Laptop secure-boot enforced (recommended dla STATE tier)
- O2 USB external FIDO2 key (Yubikey) zamiast platform authenticator
- O3 Encrypted browser profile w mode M2

## 6. Bezpieczeństwo / threat model deltas

### 6.1 Mode M1 (Pixel) — covered przez Analiza Zagrożeń

| Threat | Mitigation status |
|---|---|
| Cellebrite / forensic | covered (Verified Boot + BFU + GrapheneOS hardening) |
| Evil maid | covered (Verified Boot + Titan M2 attestation) |
| Baseband CVE | residual (per §4.2.3 Analiza), mitigated by airplane mode + WiFi only |
| RF fingerprinting | residual (PARADIS), hardware rotation per R16 |

### 6.2 Mode M2 (Laptop web) — NEW threat surface

Threats dodane przez laptop:

| Threat | Severity | Mitigation |
|---|---|---|
| **Browser exploit** (zero-day) | HIGH | Browser minimum version policy + posture API + auto-update enforcement |
| **Malicious browser extension** | HIGH | Posture check: enumerate extensions, allowlist (Vanadium has none by default) |
| **Keylogger na laptopie** (malware) | HIGH | Posture: AV/EDR signal, secure boot, FDE. Operator OPSEC policy. Cannot fully mitigate — accept residual |
| **Screen recording** (OS-level) | MEDIUM | OS-level untrusted environment. Operator policy + audit signal. Cannot fully mitigate |
| **Network MITM** (rogue WiFi pre-tunnel) | LOW | IPsec tunnel + cert auth defeats MITM po tunnel establishment. Pre-tunnel: short window, secure context only |
| **Side-channel** (Spectre etc.) | LOW | Browser process isolation + site isolation. Modern browsers mitigate |
| **Clipboard exfiltration** | MEDIUM | Server-side clipboard write API blocked. Operator policy. Audit signal jeśli paste-out attempted |
| **Save-as / Print-to-PDF** | MEDIUM | Server-side download Content-Disposition: inline + no print stylesheet + CSP no-resource-load. Cannot fully prevent screenshot of rendered content |
| **Multiple browser windows** | LOW | Single-session enforcement server-side; reuse-session-token rejection |
| **Operator using unmanaged laptop** | HIGH | Posture validation gate — block enrollment if FDE off, secure boot off, OS outdated |

**Konsekwencja:** Mode M2 ma **wyższy residual risk surface** niż Mode M1. Per subscription tier policy:

- STANDARD: oba modes equal
- PRO: oba modes, ale mode M2 wymaga posture re-validate co 8h vs 24h dla M1
- SOVEREIGN: mode M1 (Pixel) jako primary, mode M2 jako backup-only z explicit acknowledgement w operator agreement

PHANTOM `[A]` profile: **mode M1 only** (Pixel). Laptop terminal NIE jest dozwolony w phantom-a track.

## 7. Konsekwencje

### 7.1 Pozytywne

- Wider applicability (workflow z keyboard/mouse-heavy operator profiles)
- Faster operator onboarding (laptop może być pre-existing)
- Backup terminal option
- Web-based admin operations via existing infrastructure (mniej duplicacji kodu)

### 7.2 Negatywne

- Threat surface zwiększony per §6.2
- Posture validation complexity rośnie 2× (Pixel + laptop schematy)
- Operator portal jako oddzielny bundle = więcej kodu do utrzymania
- Web client wymaga rendering protocol (WebRTC) który nie jest jeszcze implementowany
- PHANTOM `[A]` track musi explicit zakazać M2 dla jasnej separacji

### 7.3 Architecture / baseline impact

- Nie zmienia Thin Client invariant (oba modes preserve)
- Nie zmienia router decision (oba modes używają Puli AX router)
- Nie zmienia G1/G2 split, IPsec, Firecracker
- **Dodaje** operator portal `/operator/*` jako trzeci view w admin-api (po `/admin/*` i potencjalnie `/health`)

### 7.4 Compliance

- Oba modes powinny mieścić się w ISO/SOC 2 scope (baseline)
- Posture validation kontroli dla M2 muszą być audytowalne (CIS Benchmark for laptop posture)
- GDPR: oba modes są data processors operator-side; no operational data persists

## 8. Implementation plan

### Phase A — Skeleton (teraz, ta sesja)

| # | Deliverable | Scope |
|---|---|---|
| A1 | `DEVICE_TYPES.LAPTOP_TERMINAL` w `constants.js` | metadata only |
| A2 | `apps/operator-web/` shell (HTML + CSS + JS minimal) | placeholder UI |
| A3 | `admin-api/src/app.js` mount `/operator` route serving operator-web | static serving |
| A4 | Operator-side endpoints stub: `/operator/me`, `/operator/devices`, `/operator/settings/fido2`, `/operator/settings/hsm` (placeholder responses) | governance metadata |
| A5 | Test `admin-web-static.test.js` extended dla `/operator/*` | basic smoke |

**Wykluczone z skeleton (future phases):**
- Real WebRTC pixel stream
- Real device posture validation
- Real FIDO2 enrollment flow w operator portal (placeholder UI only)
- Real HSM key management UI (placeholder UI only)
- IPsec tunnel actual establishment (router firmware scope, separate)

### Phase B — Operator self-service (post-router-arrival)

- Operator login w `/operator` z FIDO2 enrollment workflow
- Device posture API actual implementation
- VPN status visibility

### Phase C — Pixel SYLION app

- Native GrapheneOS app, signed, audited
- WebRTC client lub renderer protocol
- Storage policy enforced

### Phase D — Laptop posture + rendering

- Full posture validation
- WebRTC streaming working
- Production-grade operator portal

## 9. HUMAN GATE / Open items

1. **WebRTC vs alternative** rendering protocol — Architect decision (latency vs complexity)
2. **Browser minimum policy** — który Chrome/Edge/Firefox version cut-off
3. **Laptop posture API source** — natywne OS API (Windows BitLocker, macOS FileVault) lub external (CrowdStrike Falcon, etc.)
4. **PHANTOM exclusion of M2** — confirm policy: laptop NIE jest dopuszczalny w phantom-a
5. **Operator portal frontend stack** — vanilla (zgodnie z admin-web) lub framework (React/Vue/Svelte)?
6. **Single-session enforcement** — strict (rejected concurrent) lub lenient (warning + audit)
7. **Subscription tier policy dla mode availability** — STANDARD: both, PRO: both with diff TTL, SOVEREIGN: M1 primary

## 10. Sign-off

| Rola | Nazwisko | Data | Decyzja | Komentarz |
|---|---|---|---|---|
| Architect | _________ | ____ | ☐ approve ☐ reject ☐ changes | |
| CISO | _________ | ____ | ☐ approve ☐ reject ☐ changes | |
| Security | _________ | ____ | ☐ approve ☐ reject ☐ changes | |

---

## Appendix A — Źródła

- `SYLION_PHANTOM_v3.0.docx` §1.1 (Pixel renderer), §4.2.3 (baseband), §4.4 (terminal threats)
- `SYLION-Analiza-Zagrozen-COMPLETE.pdf` §4.4 (terminal layer), R1-R5 (terminal recommendations)
- `SYLION Ksiega v3 4 FIXED.docx` (Thin Client invariant)
- `shared/references/legal-safety-boundaries.md` (PHANTOM separation)
- [`adr/ADR-router-phantom-001.md`](./ADR-router-phantom-001.md) REVISED (Puli AX router)
- [`adr/ADR-router-baseline-002.md`](./ADR-router-baseline-002.md)
- [`docs/operator-onboarding/pixel-wipe-and-grapheneos.md`](../docs/operator-onboarding/pixel-wipe-and-grapheneos.md)
- WebRTC for renderer: https://webrtc.org/
- Web platform security: https://web.dev/secure/
- CIS Benchmarks (laptop posture): https://www.cisecurity.org/cis-benchmarks
