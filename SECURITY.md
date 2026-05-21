# Security Policy

> **DRAFT** — wstępna polityka disclosure. Wersja końcowa wymaga zatwierdzenia CISO.

## Status

SYLION Secure jest **w fazie development**. `productionExecutionAllowed = false`. Repo publikowane dla transparency, audit, verification — nie jako produkt do wdrożenia.

## Reporting a vulnerability

**Nie zgłaszaj** podatności bezpieczeństwa przez:

- public GitHub issues
- public discussion threads
- chat / Discord / Slack / email z domeną darmową
- social media

**Zgłaszaj** przez:

1. **GitHub Security Advisory** (preferowane): `Security` tab w repo → `Report a vulnerability`. To kanał szyfrowany, widoczny tylko dla maintainerów.
2. Jeśli GHSA nie jest dostępne (np. ze względu na charakter zgłoszenia), użyj kanału kontaktowego zewnętrznego — patrz §"Contact" w `README.md`.

W zgłoszeniu podaj:

- opis podatności,
- ścieżkę reprodukcji (commit hash, kroki, oczekiwany vs faktyczny stan),
- ocenę severity (low / medium / high / critical) wraz z uzasadnieniem,
- proponowaną mitygację jeśli widzisz,
- czy preferujesz disclosure attribution czy anonymity.

## Response SLO (draft)

| Severity | Acknowledgement | Initial assessment | Fix or mitigation |
|---|---|---|---|
| Critical | 24h | 72h | 14 dni |
| High | 48h | 7 dni | 30 dni |
| Medium | 7 dni | 14 dni | 90 dni |
| Low | 14 dni | 30 dni | best effort |

SLO są aspiracyjne, single-author project — patrz §"Disclosure scope".

## In scope

### Baseline (certifiable)

- `services/admin-api/` — Node.js admin API, RBAC, WebAuthn, audit, CDR, provisioning, live execution gates
- `apps/admin-web/` — Admin UI
- `services/admin-api/src/modules/release/` — Release control gates
- `services/admin-api/src/modules/live/` — Live execution path (gated, default-deny)
- `services/admin-api/src/modules/phantom/` — **PHANTOM governance metadata layer only** (nie execution)
- `services/admin-api/src/modules/audit/` — Hash chain audit
- Authentication / authorization boundaries
- Token / secret handling (`EnvSecretProvider`, secret manager adapter)
- Sanitization layers (provider responses, audit fields)
- HUMAN GATE enforcement w runtime

### Documentation

- ADR-y w `adr/`
- `shared/references/*.md`
- README / SECURITY / LICENSE

## Out of scope (do not report as security)

- **PHANTOM `[A]` operational design** w `SYLION_PHANTOM_v3.0.docx` i `SYLION-Analiza-Zagrozen-COMPLETE.pdf` — to **dokumentacja designu i residual risks**, nie kod produkcyjny. Jeśli uważasz że PHANTOM v3.0 sam w sobie jest concern, raportuj jako **legal/compliance feedback**, nie security vulnerability.
- Brak fizycznych egzemplarzy testowanego hardware (Puli AX, HSM, GrapheneOS Pixel) — to znane braki, udokumentowane w `adr/ADR-router-phantom-001.md`.
- Zewnętrzne provider'y (Hetzner, OVH, GL.iNet, Quectel, Google, Cloudflare) — zgłaszaj do nich bezpośrednio.
- Brak production HSM integration — to known gap w release gates.
- Brak vault adapter — `EnvSecretProvider` jest interface, vault swap pending; nie podatność.
- `console.log` w `services/admin-api/src/server.js:10` — known minor logging gap (F-24 w audytach).

## Scope nuance: PHANTOM legal-review materials

Zgodnie z `shared/references/legal-safety-boundaries.md`, treści dotyczące:

- IMEI / IMSI manipulation,
- jurisdictional rotation w celu unikania lawful access,
- stealth transport,
- evidence destruction poza approved incident response,

są **legal-review zones**. Jeśli wykryjesz że kod **runtime** zaczyna realizować takie operacje (vs governance metadata), to JEST security/compliance issue i zgłoś przez GHSA. Per Step 3.16 invariant, runtime nie wykonuje PHANTOM execution — `record.resourceType !== "phantom"` w `provisioningApprovalService.js` jest twardym blokadą.

## Safe harbor

Jeśli zgłaszasz w dobrej wierze, zgodnie z tą polityką, copyright holder zobowiązuje się nie podejmować kroków prawnych za:

- niezamierzone naruszenie warunków LICENSE w trakcie security research,
- ujawnienie szczegółów technicznych podatności po skoordynowanym disclosure window.

Nie obejmuje to: aktywnej eksploatacji u prawdziwych użytkowników, ekstrakcji prawdziwych danych, lub innych działań niezgodnych z prawem.

## Coordinated disclosure

Po fix lub mitygacji, copyright holder publikuje:

- changelog w commit message,
- GitHub Security Advisory (CVE jeśli applicable),
- attribution (chyba że reporter wybrał anonymity).

Disclosure window default: **90 dni** od initial report, lub krócej jeśli fix wcześniej.

## Pytania

Pytania o tę politykę → przez GitHub Discussions (gdy włączone) lub kanał kontaktowy w `README.md`.
