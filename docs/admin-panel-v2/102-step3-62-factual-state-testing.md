# Step 3.62 - Factual State Testing Gate

Status: implementation rule frozen
Scope: Pixel, laptop, G1, G2, AX102 workload host, Firecracker GUI workloads, container fallback workloads

## Decision

SYLION readiness cannot be granted from infrastructure liveness alone. A workload is not production-ready when the only evidence is:

- HTTP 200 or an open TCP port.
- A running container, VM, process, websockify, noVNC, Kasm, or Selkies shell.
- A login prompt, directory listing, generic browser new tab, vendor download page, or placeholder landing page.
- A script-local assertion without a screenshot, UI dump, route proof, and app-specific marker.

The production-readiness model now requires factual state evidence. The app row remains blocked with `factual_state_not_verified` until Pixel or laptop testing proves that the intended application is actually rendered and usable through the required route.

## Required Evidence Per App

Each application check must capture:

- Terminal path: Pixel or laptop, with route through G1, G2, and workload gateway.
- Stream path: workload host endpoint, private G2 route, TLS state, and no public bypass.
- Runtime path: Firecracker microVM evidence when required, or explicit container fallback gate for lower tiers.
- UI evidence: screenshot artifact and UI dump where possible.
- App-specific marker: visible app UI, working interaction, or a recorded blocker explaining why the UI is not production-ready.
- Security invariant: `terminalDataStored=false`, `cdrRequired=true`, `privateRouteRequired=true`, and `productionExecutionAllowed=false` until human gate.

## App Acceptance Rules

| App | Minimum factual proof |
| --- | --- |
| DuckDuckGo | Browser opens DuckDuckGo, can search or load a public page, and the rendered page is not a generic Firefox/Google new tab. |
| LibreOffice | LibreOffice UI opens and a new document/spreadsheet surface can be interacted with. |
| WhatsApp | WhatsApp Web or Android-native WhatsApp opens to the real pairing/login surface. |
| Telegram | Telegram Web/Desktop/Android-native opens to the real login surface. |
| Threema | Threema Web/Desktop/Android-native opens to the real login surface. |
| Signal | Signal Desktop or Android-native opens to the real Signal pairing/onboarding surface. |
| Zangi | Android-native Zangi workload opens to the real app; a public download page is a blocker. |
| Exodus | Dedicated isolated wallet runtime opens to the real app; a vendor download page is a blocker. |

## Regression Rule

Every live release run must execute:

1. Server-side runtime audit on AX102.
2. G2 route probe for every app hostname.
3. Pixel ADB human regression for every app.
4. Laptop browser regression for every app.
5. Negative check that no app is marked ready from HTTP/container/noVNC evidence only.

Screenshots that expose pairing QR codes or account secrets must remain local evidence and must not be committed to Git.

## Current Known Blockers

- Signal has a live Kasm container path, but native Firecracker evidence reports `visibleWindow=false`.
- Zangi requires Android-native workload implementation; download page evidence is not acceptable.
- Exodus requires a dedicated isolated wallet runtime; download page evidence is not acceptable.
- Puli AX, HSM, and FIDO2 remain deferred physical gates.
