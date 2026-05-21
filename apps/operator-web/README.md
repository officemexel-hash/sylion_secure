# apps/operator-web — Operator Portal (skeleton)

Operator-facing portal serwowany przez `services/admin-api` pod ścieżką `/operator/*`.

Per [`adr/ADR-terminal-modes-001.md`](../../adr/ADR-terminal-modes-001.md).

## Scope (skeleton, Phase A)

- Statyczny shell HTML/CSS/JS bez bundlera
- Hash-based routing między 8 widokami
- Fetch z `/operator-api/*` stub endpoints
- Terminal mode detection (Mode M1 Pixel vs Mode M2 laptop) — naive heuristic UA, prawdziwa weryfikacja server-side w późniejszej fazie
- FIDO2 + HSM settings — **placeholder UI**, functionality deferred

## NIE zawiera (future phases)

- Real WebRTC pixel stream (rendering G2 → terminal)
- Real device posture validation (laptop OS gates, GrapheneOS attestation)
- Real FIDO2 enrollment / login (operator-side WebAuthn flow)
- Real HSM key management (czeka na ADR-vault-adapter-001 Phase B)
- Real IPsec tunnel attach (czeka na router firmware + ADR-router-baseline-002)
- Single-session enforcement
- Real RBAC scoping (operator widzi tylko swoje)

## Pliki

```
apps/operator-web/
├── index.html      # views shell + nav
├── styles.css      # dark theme, responsive, no external resources
├── app.js          # vanilla JS, hash routing, fetch stubs
└── README.md       # ten plik
```

## CSP

`index.html` ma strict CSP:
- `default-src 'self'` — żadnych external resources
- `script-src 'self'` — żadnych inline scripts
- `frame-ancestors 'none'` — anti-clickjacking
- `base-uri 'none'` — anti-injection

## Lokalne uruchomienie

```powershell
# Admin API serwuje operator-web pod /operator
npm.cmd start:admin-api
# Browser:
# http://127.0.0.1:8080/operator
```

## Test

```powershell
node --test services/admin-api/test/operator-portal-skeleton.test.js
```

## Następne kroki (Phase B+)

1. Operator login flow (FIDO2)
2. Real device list z RBAC scoping
3. Real VPN status z router-side telemetry
4. WebRTC pixel stream client
5. Posture validation API integration
