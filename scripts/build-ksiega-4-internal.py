from __future__ import annotations

import json
import importlib.util
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "docs" / "ksiega-4-0-internal"
HTML_OUT = OUT_DIR / "KSIEGA_4_0_INTERNAL_FULL_TECHNICAL_BASELINE.html"
META_OUT = OUT_DIR / "KSIEGA_4_0_INTERNAL_FULL_TECHNICAL_BASELINE.meta.json"

BASE_BUILDER = ROOT / "scripts" / "build-ksiega-4-full.py"
spec = importlib.util.spec_from_file_location("build_ksiega_4_full", BASE_BUILDER)
if spec is None or spec.loader is None:
    raise RuntimeError(f"Cannot load base builder: {BASE_BUILDER}")
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)


def internal_addendum() -> str:
    return """
    <section class="cover internal-cover">
      <h1>STRICTLY INTERNAL</h1>
      <h2>Księga 4.0 — operacyjny baseline techniczny</h2>
      <p class="subtitle">Ta warstwa jest przeznaczona dla zespołu wewnętrznego: architektów, platform engineering, SRE, SOC, bezpieczeństwa, backend/frontend, integratorów sprzętowych i osób prowadzących testy human regression.</p>
      <table class="meta">
        <tr><th>Klasyfikacja</th><td>Wewnętrzne / restricted distribution / bez sekretów produkcyjnych.</td></tr>
        <tr><th>Zakres wykonawczy</th><td>Runbooki legalnych modułów: portal, admin, operator, providerzy, G1/G2, Puli AX, Pixel, Firecracker, CDR, monitoring, testy.</td></tr>
        <tr><th>Zakres wyłączony</th><td>Brak instrukcji manipulacji publicznymi identyfikatorami telekomunikacyjnymi, obchodzenia lawful controls albo ukrywania działań przed operatorami/regulatorami.</td></tr>
      </table>
    </section>

    <section>
      <h1>INT-1. Executive Technical Baseline</h1>
      <p>Wersja internal rozszerza Księgę 4.0 o procedury techniczne i kryteria wykonawcze dla zespołów wdrożeniowych. Jej celem jest usunięcie niejednoznaczności: każdy moduł ma mieć właściciela, wejścia, wyjścia, testy, logi, rollback i warunki produkcyjności.</p>
      <table>
        <tr><th>Moduł</th><th>Owner</th><th>Wejście</th><th>Wyjście</th><th>Release gate</th></tr>
        <tr><td>Portal</td><td>Web/Billing</td><td>tier, płatność, token</td><td>claim i bootstrap event</td><td>webhook signature + idempotency + token hash</td></tr>
        <tr><td>Admin</td><td>Backend/Security</td><td>operator/provider/tier policy</td><td>provisioning plan</td><td>RBAC + step-up + audit</td></tr>
        <tr><td>Operator</td><td>Frontend/Platform</td><td>sesja i subskrypcja</td><td>kontrola środowisk</td><td>quota + ownership + no cross-tenant data</td></tr>
        <tr><td>G1</td><td>SRE</td><td>router/terminal cert</td><td>tunel do G2</td><td>VPN evidence + no bypass</td></tr>
        <tr><td>G2</td><td>Platform</td><td>sesja operatora</td><td>stream workloadu</td><td>session cap + no content logging</td></tr>
        <tr><td>Workload</td><td>Platform</td><td>app manifest</td><td>microVM/container</td><td>recreate proof + isolation proof</td></tr>
        <tr><td>CDR</td><td>Security</td><td>file ingress/egress</td><td>allow/deny/quarantine</td><td>sanitization evidence</td></tr>
        <tr><td>Monitoring</td><td>SOC</td><td>metadata</td><td>alert/incident</td><td>no content capture + incident SLA</td></tr>
      </table>
    </section>

    <section>
      <h1>INT-2. Portal Runbook</h1>
      <h2>INT-2.1 Zakres portalu</h2>
      <p>Portal publiczny obsługuje zakup tokenu, claim tokenu, generację paczek startowych i inicjalizację operatora. Portal nie obsługuje panelu admina, panelu operatora ani streamingu workloadów.</p>
      <h2>INT-2.2 Procedura wdrożenia portalu</h2>
      <table>
        <tr><th>Krok</th><th>Działanie</th><th>Dowód</th><th>Rollback</th></tr>
        <tr><td>1</td><td>Utworzyć osobny VPS portalowy i skonfigurować tylko publiczne route'y portalu.</td><td>inventory + firewall snapshot</td><td>remove DNS + destroy VPS</td></tr>
        <tr><td>2</td><td>Skonfigurować TLS, HSTS, CSP i oddzielny secret do komunikacji z Admin API.</td><td>security header report</td><td>revoke edge secret</td></tr>
        <tr><td>3</td><td>Podłączyć Stripe, CoinGate i Mollie w trybie testowym.</td><td>signed webhook test</td><td>disable payment provider</td></tr>
        <tr><td>4</td><td>Włączyć token service: hash tokenu, typ tokenu, scope, termin ważności.</td><td>token ledger event</td><td>revoke unclaimed tokens</td></tr>
        <tr><td>5</td><td>Uruchomić claim flow i sprawdzić atomowość jednorazowego użycia.</td><td>double-claim negative test</td><td>block claim route</td></tr>
      </table>
      <h2>INT-2.3 Testy portalu</h2>
      <ul>
        <li>Zakup Pilot, Standard, Pro, Phantom i Sovereign w trybie sandbox.</li>
        <li>Webhook z poprawnym podpisem przechodzi, webhook bez podpisu jest odrzucony.</li>
        <li>Ten sam webhook nie tworzy dwóch tokenów.</li>
        <li>Token po claimie nie może być użyty drugi raz.</li>
        <li>Portal nie ma dostępu do route'ów admina/operatora/workload stream.</li>
      </ul>
    </section>

    <section>
      <h1>INT-3. Admin Panel Runbook</h1>
      <h2>INT-3.1 Zakładki wymagane</h2>
      <table>
        <tr><th>Zakładka</th><th>Minimalne funkcje</th><th>Test</th></tr>
        <tr><td>Dashboard</td><td>stan systemu, operatorzy, koszty, alerty, gates</td><td>Playwright + API status</td></tr>
        <tr><td>Operators</td><td>lista operatorów, tier, koszt, G1/G2/workload, sesja, status</td><td>create/list/update</td></tr>
        <tr><td>Providers</td><td>kraje, capabilities, koszty, KVM, Firecracker, TDX, SEV-SNP</td><td>provider capability matrix</td></tr>
        <tr><td>Subscriptions</td><td>ceny, terminy, limity, upgrade, tokeny</td><td>quota enforcement</td></tr>
        <tr><td>Apps</td><td>globalnie autoryzowane aplikacje i wersje desktop/web/native</td><td>operator cannot add global app</td></tr>
        <tr><td>Monitoring</td><td>metadane ścieżki, anomalia, alerty, incidenty</td><td>synthetic anomaly</td></tr>
        <tr><td>CDR</td><td>polityki plików, quarantine, decyzje</td><td>file flow tests</td></tr>
        <tr><td>PHANTOM</td><td>hardening gates, lab-only records, human gates</td><td>execution stays false</td></tr>
      </table>
      <h2>INT-3.2 Zasady administracyjne</h2>
      <ul>
        <li>Operacje provider secrets wymagają step-up.</li>
        <li>Operacje destrukcyjne wymagają four-eyes albo równoważnego gate'u.</li>
        <li>Panel admina nie pokazuje haseł, tokenów providerów, seedów, treści wiadomości ani danych walletów.</li>
        <li>Koszt operatora musi być liczony z G1, G2, workload, storage, transfer, dodatków i kosztu bare metal pool.</li>
      </ul>
    </section>

    <section>
      <h1>INT-4. Operator Panel Runbook</h1>
      <h2>INT-4.1 Zakładki operatora</h2>
      <table>
        <tr><th>Zakładka</th><th>Funkcja</th><th>Dowód działania</th></tr>
        <tr><td>Overview</td><td>status sesji, licznik, terminal, G1/G2/workload</td><td>session JSON + UI screenshot</td></tr>
        <tr><td>Apps</td><td>launcher do aplikacji i panelu</td><td>Pixel ADB click-through</td></tr>
        <tr><td>Workload Control</td><td>counts, recreate, prepare new session</td><td>microVM/container ID changes</td></tr>
        <tr><td>Streaming</td><td>fit mode, keyboard, input tools</td><td>typing and scroll test</td></tr>
        <tr><td>Security Unlock</td><td>hasła G1/G2/workload, session TTL, FIDO2 placeholder</td><td>expiry/re-auth test</td></tr>
        <tr><td>Backup & Panic</td><td>backup, inactivity wipe, panic levels</td><td>dry-run + gated destructive test</td></tr>
        <tr><td>Jurisdiction</td><td>kraje i częstotliwość w ramach tieru</td><td>policy deny/allow</td></tr>
        <tr><td>Matrix Server</td><td>wniosek o własny serwer Matrix</td><td>provisioning plan</td></tr>
      </table>
      <h2>INT-4.2 Test human usability</h2>
      <p>Operator panel nie jest gotowy, jeśli da się go tylko otworzyć. Musi dać się przejść na Pixelu i laptopie: klik, scroll, wpisywanie, przełączenie aplikacji, powrót do panelu, reset aplikacji, ponowny start aplikacji.</p>
    </section>

    <section>
      <h1>INT-5. G1/G2 Runbook</h1>
      <h2>INT-5.1 G1</h2>
      <ul>
        <li>G1 jest indywidualne dla operatora.</li>
        <li>G1 przyjmuje tylko ruch z dopuszczonego terminal/router policy.</li>
        <li>G1 nie przechowuje danych aplikacyjnych.</li>
        <li>G1 ma mieć dowód tunelu do G2 oraz negatywny test braku bypassu.</li>
      </ul>
      <h2>INT-5.2 G2</h2>
      <ul>
        <li>G2 brokuje sesję i dostęp do workloadu.</li>
        <li>G2 ma limit połączeń per operator i per user.</li>
        <li>G2 nie zapisuje treści streamu ani wejścia.</li>
        <li>Docelowy PHANTOM wymaga blind broker/E2EE stream.</li>
      </ul>
      <h2>INT-5.3 Dowody</h2>
      <table>
        <tr><th>Kontrola</th><th>Dowód</th><th>Wynik wymagany</th></tr>
        <tr><td>G1 reachable only via allowed path</td><td>negative route tests</td><td>direct access denied</td></tr>
        <tr><td>G1 to G2 tunnel</td><td>metadata + service health</td><td>healthy</td></tr>
        <tr><td>G2 session cap</td><td>parallel connection test</td><td>over-limit denied</td></tr>
        <tr><td>No stream persistence</td><td>storage/log grep</td><td>no content artifacts</td></tr>
      </table>
    </section>

    <section>
      <h1>INT-6. Workload i Firecracker Runbook</h1>
      <h2>INT-6.1 Minimalny lifecycle środowiska</h2>
      <table>
        <tr><th>Stan</th><th>Opis</th><th>Akcja</th></tr>
        <tr><td>planned</td><td>środowisko zaplanowane przez entitlement</td><td>operator może zobaczyć quota</td></tr>
        <tr><td>prepared</td><td>obraz i manifest gotowe</td><td>można uruchomić</td></tr>
        <tr><td>running</td><td>microVM/kontener działa</td><td>stream available</td></tr>
        <tr><td>usable</td><td>aplikacja przeszła test człowieka</td><td>status app works</td></tr>
        <tr><td>needs-account</td><td>aplikacja działa, ale wymaga konta/SMS</td><td>czeka na operatora</td></tr>
        <tr><td>broken</td><td>aplikacja nie działa lub stream/input zepsuty</td><td>defect + recreate</td></tr>
        <tr><td>destroyed</td><td>środowisko usunięte</td><td>audit + cleanup proof</td></tr>
      </table>
      <h2>INT-6.2 Aplikacje wymagane</h2>
      <p>Każda aplikacja ma mieć status per wersja: desktop, web, Android-native. Jeżeli web nie pozwala założyć konta, status nie może być "works"; powinien być "limited" albo "needs native".</p>
      <table>
        <tr><th>Aplikacja</th><th>Tryby</th><th>Test minimum</th></tr>
        <tr><td>DuckDuckGo</td><td>desktop/web</td><td>search, typing, scroll, cookies, page load</td></tr>
        <tr><td>LibreOffice</td><td>desktop</td><td>open, edit, save test doc, recreate</td></tr>
        <tr><td>Signal</td><td>desktop/native</td><td>start, account state, QR/SMS handoff</td></tr>
        <tr><td>Telegram</td><td>desktop/web/native</td><td>start, phone/SMS handoff, session state</td></tr>
        <tr><td>WhatsApp</td><td>desktop/web/native</td><td>start, QR/phone handoff, limitations explicit</td></tr>
        <tr><td>Threema</td><td>desktop/web/native</td><td>start, license/account state</td></tr>
        <tr><td>Zangi</td><td>native/desktop where available</td><td>APK provenance, auth state, stream</td></tr>
        <tr><td>Exodus</td><td>desktop</td><td>launch only, no seed/private key capture</td></tr>
      </table>
    </section>

    <section>
      <h1>INT-7. Pixel, Puli AX i terminal admission</h1>
      <h2>INT-7.1 Pixel</h2>
      <ul>
        <li>Pixel ma mieć profil GrapheneOS, certyfikat CA, browser profile i shortcut do panelu operatora.</li>
        <li>Nie wolno zapisywać danych aplikacyjnych na terminalu.</li>
        <li>Test ADB musi potwierdzić klik, scroll, keyboard, app switching i powrót do panelu.</li>
      </ul>
      <h2>INT-7.2 Puli AX</h2>
      <ul>
        <li>Puli AX ma mieć paczkę routera, tunel do G1, kill switch i DNS leak prevention.</li>
        <li>Router ma raportować status do panelu, ale nie być jedynym zaufanym końcem bezpieczeństwa.</li>
        <li>Po restarcie routera Pixel powinien odzyskać ścieżkę bez ręcznego obchodzenia policy.</li>
      </ul>
      <h2>INT-7.3 PHANTOM admission</h2>
      <p>W PHANTOM dostęp do G1 wymaga korelacji terminala, routera i FIDO2. Jeśli jeden element nie przechodzi policy, system ma zablokować sesję.</p>
    </section>

    <section>
      <h1>INT-8. Monitoring, CDR i incident response</h1>
      <h2>INT-8.1 Blue-team metadata</h2>
      <p>Monitoring ma widzieć ścieżkę i anomalie, ale nie treść pracy operatora. Zbieramy metadane, statusy, błędy, czasy, identyfikatory środowisk, decyzje CDR i alerty.</p>
      <h2>INT-8.2 Incident response</h2>
      <table>
        <tr><th>Sygnał</th><th>Reakcja</th><th>Gate</th></tr>
        <tr><td>zmiana klucza bez planu</td><td>freeze operator session, revoke suspect cert</td><td>SOC + Security</td></tr>
        <tr><td>próba direct bypass G1/G2</td><td>block source, create incident, rotate credentials</td><td>SRE</td></tr>
        <tr><td>CDR quarantine spike</td><td>raise risk level, notify admin, hold files</td><td>Security</td></tr>
        <tr><td>workload escape signal</td><td>stop host, isolate workload, preserve metadata evidence</td><td>Critical gate</td></tr>
        <tr><td>panic code</td><td>execute configured legal policy level</td><td>pre-approved policy</td></tr>
      </table>
    </section>

    <section>
      <h1>INT-9. PHANTOM Internal Annex Boundary</h1>
      <p>PHANTOM może mieć wewnętrzne aneksy prawne i laboratoryjne poza repo. W Księdze 4.0 widoczna jest struktura, wymagania, testy, ryzyka i human gates. Instrukcje wykonawcze dotyczące obszarów regulowanych muszą być prowadzone przez uprawniony zespół prawny/telekom/lab i przechowywane w odrębnym kontrolowanym repozytorium albo sejfie dokumentów.</p>
      <table>
        <tr><th>Obszar</th><th>Status w Księdze</th><th>Gdzie może istnieć szczegółowy SOP</th></tr>
        <tr><td>RF lab</td><td>governance i test preflight</td><td>zewnętrzny lab SOP po legal approval</td></tr>
        <tr><td>SIM/modem identity</td><td>risk model i compliance boundary</td><td>autoryzowane środowisko laboratoryjne</td></tr>
        <tr><td>Traffic camouflage</td><td>legal review i threat model</td><td>counsel-approved research annex</td></tr>
        <tr><td>Forensic response</td><td>incident response i retention policy</td><td>legal IR playbook</td></tr>
      </table>
    </section>
    """


def _table(headers, rows, css_class=""):
    head = "".join(f"<th>{base.e(h)}</th>" for h in headers)
    body = []
    for row in rows:
        body.append("<tr>" + "".join(f"<td>{base.e(c)}</td>" for c in row) + "</tr>")
    klass = f' class="{css_class}"' if css_class else ""
    return f"<table{klass}><tr>{head}</tr>{''.join(body)}</table>"


def _detail_card(title: str, fields: list[tuple[str, str]], klass: str = "") -> str:
    class_attr = f' detail-card {klass}'.strip()
    rows = []
    for label, value in fields:
        rows.append(
            f'<div class="detail-field"><div class="detail-label">{base.e(label)}</div>'
            f'<div class="detail-value">{base.e(value)}</div></div>'
        )
    return f'<article class="{class_attr}"><h3>{base.e(title)}</h3>{"".join(rows)}</article>'


def _detail_cards(cards: list[tuple[str, list[tuple[str, str]]]], klass: str = "") -> str:
    return "\n".join(_detail_card(title, fields, klass) for title, fields in cards)


def internal_extra_css() -> str:
    return """
    body { font-size: 10.4pt; line-height: 1.62; }
    p { margin: 8px 0; }
    table { page-break-inside: auto; break-inside: auto; }
    tr { page-break-inside: avoid; break-inside: avoid; }
    .wide { font-size: 7.4pt; line-height: 1.28; }
    .toc { page-break-before: always; }
    .toc table { font-size: 8.8pt; }
    .toc td:first-child { width: 28%; font-weight: 700; color: #0a3558; }
    .detail-card {
      border: 1px solid #c6d2dd;
      border-left: 5px solid #2f80ed;
      background: #fbfdff;
      padding: 10px 12px;
      margin: 10px 0 14px;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .detail-card h3 {
      margin-top: 0;
      color: #082340;
      font-size: 12.2pt;
      border-bottom: 1px solid #d8e3ed;
      padding-bottom: 4px;
    }
    .detail-field { margin: 7px 0; }
    .detail-label { font-weight: 700; color: #0a3558; margin-bottom: 2px; }
    .detail-value { color: #172033; }
    .module-detail { page-break-before: always; }
    .module-detail h2 { font-size: 16pt; border-bottom: 1px solid #d8e3ed; padding-bottom: 5px; }
    .risk-card { border-left-color: #b42318; background: #fffafa; }
    .portal-card { border-left-color: #25a18e; background: #fbfffd; }
    .gate-card { border-left-color: #e0a100; background: #fffdf6; }
    .compact-list { margin: 6px 0 10px 18px; }
    """


def static_table_of_contents() -> str:
    rows = [
        ("0", "Strictly Internal cover", "Klasyfikacja, zakres, ograniczenia i bezpieczne granice dokumentu."),
        ("INT-1", "Executive Technical Baseline", "Mapa modułów, ownerów, wejść, wyjść i release gates."),
        ("INT-2", "Portal Runbook", "Pierwszy, skrócony runbook portalu i testów płatności/tokenów."),
        ("INT-3", "Admin Panel Runbook", "Zakładki, zasady, RBAC, providerzy, koszty, subskrypcje, CDR i monitoring."),
        ("INT-4", "Operator Panel Runbook", "Środowiska aplikacji, streaming, sesje, backup, panic, rotacja i Matrix."),
        ("INT-5", "G1/G2 Runbook", "Gateway, broker, brak bypassu, dowody tuneli i session caps."),
        ("INT-6", "Workload i Firecracker", "Lifecycle środowisk, aplikacje, tryby desktop/native, recreate proof."),
        ("INT-7", "Pixel, Puli AX i terminal admission", "Terminal, router, certyfikaty, pakiety i PHANTOM admission."),
        ("INT-8", "Monitoring, CDR i incident response", "Metadane, alerty, CDR, playbooki i granice widoczności."),
        ("INT-9", "PHANTOM Internal Annex Boundary", "Rozdział baseline, governance, lab-only i restricted SOP."),
        ("A", "Security & Architecture Atlas", "Diagramy, STRIDE, wektory zagrożeń, kontrola izolacji i brokerów."),
        ("B", "Księga SYLION v3.4 FIXED import", "Pełny import źródłowej Księgi 3.4 dla traceability."),
        ("C", "PHANTOM v3.0 source index", "Indeks struktury PHANTOM i rozdzielenie warstw [A]/governance."),
        ("X", "Portal zakupowy, płatności, tokeny i resellerzy", "B2C, B2B, crypto, Stripe, CoinGate, Mollie, token lifecycle, UI i privacy."),
        ("Z", "Końcowe porównanie i panel administratora", "3.4 vs PHANTOM vs 4.0, admin console, blue-team observation, KPI/SLO."),
        ("Y", "Scenariusze ataków i obrona per tier", "Attack paths, Pilot/Standard/Pro/Phantom/Sovereign, residual risks i testy."),
        ("W", "Rozszerzony masterplan modułów i testów", "Szczegółowe opisy modułów, workflow, dane, kontrole, awarie i kryteria odbioru."),
    ]
    return "\n".join([
        '<section class="toc">',
        '<h1>SPIS TREŚCI TECHNICZNY</h1>',
        '<p>Spis treści jest statyczną mapą wewnętrznej Księgi 4.0. Wersja PDF generowana przez Chromium nie ma automatycznych numerów stron w treści, dlatego ten spis pełni rolę mapy sekcji, a nie indeksu stron.</p>',
        _table(["Sekcja", "Nazwa", "Zakres"], rows, "wide"),
        '</section>',
    ])


def security_atlas() -> str:
    diagrams = []
    diagrams.append(base.svg(
        [
            {"id": "z0", "label": "Zone 0\nPublic Portal", "x": 35, "y": 95, "w": 160, "h": 70},
            {"id": "z1", "label": "Zone 1\nTerminal", "x": 240, "y": 95, "w": 160, "h": 70},
            {"id": "z2", "label": "Zone 2\nPuli AX / WAN", "x": 445, "y": 95, "w": 170, "h": 70},
            {"id": "z3", "label": "Zone 3\nG1/G2", "x": 665, "y": 95, "w": 160, "h": 70},
            {"id": "z4", "label": "Zone 4\nWorkloads", "x": 870, "y": 95, "w": 160, "h": 70},
            {"id": "mgmt", "label": "Zone 5\nAdmin/SOC/PKI", "x": 360, "y": 280, "w": 250, "h": 85, "fill": "#eef8f4", "stroke": "#25a18e"},
            {"id": "aud", "label": "Audit/CDR/SIEM\nmetadata only", "x": 705, "y": 280, "w": 250, "h": 85, "fill": "#fff8e8", "stroke": "#e0a100"},
        ],
        [
            ("z0", "mgmt", "token event"),
            ("z1", "z2", "local link"),
            ("z2", "z3", "VPN"),
            ("z3", "z4", "session"),
            ("z3", "aud", "events"),
            ("z4", "aud", "CDR"),
            ("mgmt", "aud", "policy"),
        ],
        "A1. Zone model 0-5 i granice zaufania",
    ))
    diagrams.append(base.svg(
        [
            {"id": "cp", "label": "Control Plane\nAdmin API / policy", "x": 60, "y": 90, "w": 240, "h": 85, "fill": "#eef5ff"},
            {"id": "dp", "label": "Data Plane\npixel stream / input", "x": 60, "y": 285, "w": 240, "h": 85, "fill": "#eef8f4"},
            {"id": "prov", "label": "Provisioning\nG1/G2/workload", "x": 390, "y": 90, "w": 230, "h": 85},
            {"id": "runtime", "label": "Runtime Session\nterminal to app", "x": 390, "y": 285, "w": 230, "h": 85},
            {"id": "audit", "label": "Audit Plane\nimmutable metadata", "x": 730, "y": 185, "w": 250, "h": 95, "fill": "#fff8e8", "stroke": "#e0a100"},
        ],
        [
            ("cp", "prov", "plans"),
            ("prov", "runtime", "creates"),
            ("runtime", "dp", "pixels"),
            ("cp", "audit", "policy events"),
            ("runtime", "audit", "session events"),
            ("prov", "audit", "inventory"),
        ],
        "A2. Control plane, data plane i audit plane",
    ))
    diagrams.append(base.svg(
        [
            {"id": "pay", "label": "Payment fraud\nspoof webhook", "x": 40, "y": 80, "w": 190, "h": 70},
            {"id": "tok", "label": "Token abuse\nreplay / forge", "x": 310, "y": 80, "w": 190, "h": 70},
            {"id": "boot", "label": "Bootstrap abuse\nwrong tier", "x": 580, "y": 80, "w": 190, "h": 70},
            {"id": "infra", "label": "Infra abuse\nprovider mutation", "x": 850, "y": 80, "w": 180, "h": 70},
            {"id": "ctrl", "label": "Controls\nsignatures, hash,\nidempotency, RBAC", "x": 320, "y": 285, "w": 260, "h": 100, "fill": "#eef8f4", "stroke": "#25a18e"},
            {"id": "evi", "label": "Evidence\nledger + audit", "x": 675, "y": 295, "w": 220, "h": 80, "fill": "#fff8e8", "stroke": "#e0a100"},
        ],
        [
            ("pay", "tok", "webhook"),
            ("tok", "boot", "claim"),
            ("boot", "infra", "provision"),
            ("pay", "ctrl", "validate"),
            ("tok", "ctrl", "one-time"),
            ("infra", "evi", "log"),
            ("ctrl", "evi", "proof"),
        ],
        "A3. Threat map portalu, tokenów i bootstrapu",
    ))
    diagrams.append(base.svg(
        [
            {"id": "admin", "label": "Admin account\nphishing / theft", "x": 50, "y": 70, "w": 210, "h": 80},
            {"id": "rbac", "label": "RBAC / step-up\nleast privilege", "x": 330, "y": 70, "w": 210, "h": 80, "fill": "#eef8f4", "stroke": "#25a18e"},
            {"id": "prov", "label": "Provider secret\nrotation / vault", "x": 610, "y": 70, "w": 210, "h": 80},
            {"id": "mut", "label": "Mutation gate\nallowlist + cap", "x": 50, "y": 270, "w": 210, "h": 80},
            {"id": "four", "label": "Four-eyes\ndestructive ops", "x": 330, "y": 270, "w": 210, "h": 80, "fill": "#fff8e8", "stroke": "#e0a100"},
            {"id": "soc", "label": "SOC alert\nanomaly + audit", "x": 610, "y": 270, "w": 210, "h": 80, "fill": "#eef5ff"},
            {"id": "stop", "label": "Containment\nrevoke / freeze", "x": 855, "y": 170, "w": 180, "h": 85, "fill": "#fdeeee", "stroke": "#b42318"},
        ],
        [
            ("admin", "rbac", "login"),
            ("rbac", "prov", "secret op"),
            ("prov", "mut", "request"),
            ("mut", "four", "if critical"),
            ("four", "soc", "audit"),
            ("soc", "stop", "incident"),
            ("rbac", "stop", "deny"),
        ],
        "A4. Admin compromise containment flow",
    ))
    diagrams.append(base.svg(
        [
            {"id": "term", "label": "Terminal seized\nactive session risk", "x": 40, "y": 90, "w": 210, "h": 80},
            {"id": "sess", "label": "Session TTL\nre-auth required", "x": 315, "y": 90, "w": 200, "h": 80, "fill": "#eef8f4", "stroke": "#25a18e"},
            {"id": "fido", "label": "FIDO2\npresence check", "x": 580, "y": 90, "w": 190, "h": 80},
            {"id": "panic", "label": "Panic policy\npredefined levels", "x": 840, "y": 90, "w": 190, "h": 80},
            {"id": "cert", "label": "Device cert\nrevoke terminal", "x": 190, "y": 285, "w": 210, "h": 80},
            {"id": "data", "label": "No local data\nthin client", "x": 480, "y": 285, "w": 210, "h": 80, "fill": "#eef8f4", "stroke": "#25a18e"},
            {"id": "risk", "label": "Residual risk\nscreen/input capture", "x": 770, "y": 285, "w": 210, "h": 80, "fill": "#fff8e8", "stroke": "#e0a100"},
        ],
        [
            ("term", "sess", "limit"),
            ("sess", "fido", "renew"),
            ("fido", "panic", "if duress"),
            ("term", "cert", "revoke"),
            ("cert", "data", "contain"),
            ("data", "risk", "residual"),
        ],
        "A5. Terminal seizure attack path",
    ))
    diagrams.append(base.svg(
        [
            {"id": "wifi", "label": "Rogue Wi-Fi\nEvil twin", "x": 45, "y": 80, "w": 190, "h": 75},
            {"id": "router", "label": "Puli AX\npaired router", "x": 315, "y": 80, "w": 190, "h": 75},
            {"id": "vpn", "label": "VPN/Kill switch\nDNS leak block", "x": 585, "y": 80, "w": 210, "h": 75, "fill": "#eef8f4", "stroke": "#25a18e"},
            {"id": "g1", "label": "G1\nposture gate", "x": 865, "y": 80, "w": 165, "h": 75},
            {"id": "rf", "label": "Cellular metadata\noutside IPsec", "x": 175, "y": 290, "w": 230, "h": 80, "fill": "#fff8e8", "stroke": "#e0a100"},
            {"id": "gov", "label": "RF Lab Governance\nno product executor", "x": 535, "y": 290, "w": 260, "h": 80, "fill": "#eef5ff"},
        ],
        [
            ("wifi", "router", "attempt"),
            ("router", "vpn", "tunnel"),
            ("vpn", "g1", "allow/deny"),
            ("router", "rf", "WAN exposure"),
            ("rf", "gov", "document risk"),
        ],
        "A6. Wi-Fi/router/RF threat boundary",
    ))
    diagrams.append(base.svg(
        [
            {"id": "g2", "label": "G2 broker\nRCE/session abuse", "x": 60, "y": 95, "w": 230, "h": 80},
            {"id": "cap", "label": "Session cap\nper operator", "x": 360, "y": 95, "w": 210, "h": 80, "fill": "#eef8f4", "stroke": "#25a18e"},
            {"id": "log", "label": "No content logs\nmetadata only", "x": 640, "y": 95, "w": 230, "h": 80},
            {"id": "blind", "label": "Blind broker\nE2EE roadmap", "x": 365, "y": 285, "w": 230, "h": 80, "fill": "#fff8e8", "stroke": "#e0a100"},
            {"id": "rebuild", "label": "Rebuild/revoke\nincident response", "x": 675, "y": 285, "w": 230, "h": 80, "fill": "#fdeeee", "stroke": "#b42318"},
        ],
        [
            ("g2", "cap", "limit blast"),
            ("cap", "log", "audit"),
            ("log", "blind", "target"),
            ("g2", "rebuild", "if compromised"),
            ("blind", "rebuild", "key revoke"),
        ],
        "A7. G2 broker compromise and PHANTOM target state",
    ))
    diagrams.append(base.svg(
        [
            {"id": "app", "label": "App exploit\nbrowser/messenger/doc", "x": 45, "y": 80, "w": 230, "h": 80},
            {"id": "micro", "label": "MicroVM/container\nisolation boundary", "x": 345, "y": 80, "w": 240, "h": 80, "fill": "#eef8f4", "stroke": "#25a18e"},
            {"id": "host", "label": "Host kernel\nescape risk", "x": 665, "y": 80, "w": 210, "h": 80, "fill": "#fff8e8", "stroke": "#e0a100"},
            {"id": "cdr", "label": "CDR\nfile boundary", "x": 190, "y": 285, "w": 210, "h": 80},
            {"id": "recreate", "label": "Recreate\nclean image", "x": 480, "y": 285, "w": 210, "h": 80, "fill": "#eef8f4", "stroke": "#25a18e"},
            {"id": "soc", "label": "SOC\nruntime anomaly", "x": 770, "y": 285, "w": 210, "h": 80},
        ],
        [
            ("app", "micro", "contained"),
            ("micro", "host", "escape attempt"),
            ("app", "cdr", "file flow"),
            ("micro", "recreate", "reset"),
            ("host", "soc", "alert"),
            ("soc", "recreate", "recover"),
        ],
        "A8. Workload exploit containment",
    ))
    diagrams.append(base.svg(
        [
            {"id": "old", "label": "Operator leaves\njurisdiction", "x": 50, "y": 90, "w": 210, "h": 80},
            {"id": "freeze", "label": "Freeze\nsessions + keys", "x": 330, "y": 90, "w": 200, "h": 80},
            {"id": "wipe", "label": "Wipe/reinstall\nsecret destruction", "x": 595, "y": 90, "w": 220, "h": 80},
            {"id": "att", "label": "Attestation\ncleanup evidence", "x": 860, "y": 90, "w": 180, "h": 80},
            {"id": "pool", "label": "Return to pool\neligible lower tier", "x": 300, "y": 295, "w": 250, "h": 80, "fill": "#eef8f4", "stroke": "#25a18e"},
            {"id": "ded", "label": "Dedicated requal\nPhantom/Sovereign", "x": 645, "y": 295, "w": 260, "h": 80, "fill": "#fff8e8", "stroke": "#e0a100"},
        ],
        [
            ("old", "freeze", "stop"),
            ("freeze", "wipe", "clean"),
            ("wipe", "att", "prove"),
            ("att", "pool", "standard/pro"),
            ("att", "ded", "high tier gate"),
        ],
        "A9. VPS reuse safety lifecycle",
    ))
    diagrams.append(base.svg(
        [
            {"id": "p1", "label": "Prevent\nRBAC, certs, VPN", "x": 65, "y": 120, "w": 190, "h": 80, "fill": "#eef8f4", "stroke": "#25a18e"},
            {"id": "d1", "label": "Detect\nSIEM, anomaly, CDR", "x": 315, "y": 120, "w": 200, "h": 80, "fill": "#eef5ff"},
            {"id": "r1", "label": "Respond\nfreeze, revoke, isolate", "x": 585, "y": 120, "w": 210, "h": 80, "fill": "#fff8e8", "stroke": "#e0a100"},
            {"id": "rec", "label": "Recover\nrebuild, rotate, retest", "x": 860, "y": 120, "w": 190, "h": 80},
            {"id": "evi", "label": "Evidence\nhash chain / WORM target", "x": 380, "y": 300, "w": 280, "h": 80, "fill": "#f7f2ff", "stroke": "#7b61ff"},
        ],
        [
            ("p1", "d1", "telemetry"),
            ("d1", "r1", "alert"),
            ("r1", "rec", "action"),
            ("rec", "evi", "proof"),
            ("d1", "evi", "audit"),
        ],
        "A10. Prevent - detect - respond - recover loop",
    ))

    threat_rows = [
        ("Portal webhook spoof", "payment/portal", "free token or wrong tier", "signed webhook, idempotency, token ledger", "double-spend and forged signature tests", "Medium"),
        ("Token replay/theft", "portal/token", "unauthorized bootstrap", "hash token, one-time claim, expiry, scope", "double claim negative test", "Medium"),
        ("Admin credential theft", "admin", "provider mutation, operator abuse", "FIDO2/step-up, RBAC, four-eyes, audit", "privilege boundary test", "High"),
        ("Provider secret leak", "admin/secrets", "infrastructure takeover", "vault adapter, secret refs, no plaintext logs", "secret grep and audit leakage test", "High"),
        ("Terminal seizure", "Pixel/laptop", "active session access", "session TTL, FIDO2, revoke cert, no local data", "ADB seizure simulation", "High"),
        ("Rogue Wi-Fi", "Pixel/router", "traffic interception", "router pairing, VPN, kill switch, cert policy", "evil twin negative test", "Medium"),
        ("Router compromise", "Puli AX", "traffic manipulation", "terminal-to-G1 crypto, kill switch, router hardening", "route/DNS leak tests", "High"),
        ("G1 compromise", "G1", "pivot to G2 or metadata", "per-operator G1, no app data, revoke/rebuild", "G1 isolation test", "Medium"),
        ("G2 compromise", "G2", "stream/session exposure", "session cap, no persistence, blind broker roadmap", "no content log test", "High"),
        ("App exploit", "workload app", "control app env", "Firecracker/container, recreate, CDR", "app exploit containment drill", "High"),
        ("VM/container escape", "workload host", "host takeover", "kernel hardening, dedicated hosts, monitoring", "escape simulation/lab only", "Critical"),
        ("File-borne malware", "CDR", "payload transfer", "sanitize, quarantine, hash, allow/deny", "malicious doc test corpus", "High"),
        ("Provider snapshot", "VPS/bare metal provider", "data/metadata capture", "encryption, minimal state, dedicated tier, rotation", "provider threat review", "High"),
        ("Insider abuse", "admin/SRE/SOC", "unauthorized action", "RBAC, four-eyes, WORM audit, separation of duties", "dual-control negative test", "High"),
        ("Metadata correlation", "network/global observer", "operator linkage", "jurisdictional policy, traffic review, OPSEC", "traffic metadata review", "High"),
        ("Backup exfiltration", "backup", "data theft", "encrypted backup, operator ownership, CDR, access audit", "restore and access test", "Medium"),
        ("Panic abuse", "operator/admin", "data loss/cover-up", "predefined policy levels, audit, approval gates", "dry-run panic tests", "High"),
        ("Matrix federation abuse", "Matrix addon", "metadata leak or spam", "federation policy, moderation, Tor/onion governance", "Matrix threat test", "Medium"),
    ]
    stride_rows = [
        ("Portal", "spoofed webhook", "token tamper", "payment denial", "invoice data", "not applicable", "claim abuse"),
        ("Admin panel", "admin impersonation", "provider policy tamper", "audit dispute", "secret leakage", "service disable", "privilege escalation"),
        ("Operator panel", "session hijack", "quota tamper", "operator action dispute", "own metadata", "session exhaustion", "access to other operator"),
        ("Pixel", "device clone", "cert tamper", "local action dispute", "screen/input", "battery/network DoS", "terminal privilege"),
        ("Puli AX", "router impersonation", "route/DNS tamper", "config dispute", "WAN metadata", "WAN loss", "LAN pivot"),
        ("G1", "gateway spoof", "VPN policy tamper", "tunnel log dispute", "metadata", "gateway DoS", "pivot to G2"),
        ("G2", "broker spoof", "session tamper", "stream action dispute", "pixel stream", "session cap exhaustion", "broker RCE"),
        ("Workload", "app env spoof", "image tamper", "app action dispute", "files/messages", "resource exhaustion", "VM escape"),
        ("CDR", "policy spoof", "file transform tamper", "decision dispute", "file metadata", "queue DoS", "policy override"),
        ("Provider", "fake region", "host tamper", "SLA dispute", "snapshots/metadata", "provider outage", "provider admin"),
    ]
    controls_rows = [
        ("Terminal", "no local data, certs, session TTL", "ADB human regression, storage checks", "active compromise exposes current view"),
        ("Router", "kill switch, DNS leak prevention, VPN to G1", "route loss and DNS leak tests", "baseband and firmware remain residual"),
        ("G1", "per-operator gateway, no app data", "direct bypass negative tests", "metadata and DoS"),
        ("G2", "session limits, no content persistence", "storage/log tests", "needs blind broker for PHANTOM"),
        ("Workload", "Firecracker, recreate, quotas", "app usability and recreate proof", "host escape risk"),
        ("CDR", "sanitize/quarantine/hash", "malicious corpus tests", "unknown file formats"),
        ("Admin", "RBAC, step-up, four-eyes", "permission matrix tests", "insider risk"),
        ("Portal", "signed webhooks, token hash", "payment/token tests", "phishing token theft"),
        ("Provider", "capability registry, region policy", "provider qualification", "provider metadata"),
        ("PHANTOM", "human gates, lab-only governance", "evidence review", "not all RF risks solvable in software"),
    ]
    comparisons = [
        ("Isolation model", "Containers", "Firecracker", "Dedicated bare metal", "Confidential computing"),
        ("Primary strength", "density and cost", "microVM isolation", "physical/logical control", "attested memory protection"),
        ("Primary weakness", "kernel shared", "host kernel still shared", "cost/provisioning time", "provider/hardware support varies"),
        ("Use in tiers", "Pilot/Standard", "Pro+", "Phantom/Sovereign", "Phantom/Sovereign when qualified"),
        ("Evidence required", "container isolation tests", "microVM lifecycle tests", "inventory/attestation", "attestation quote validation"),
    ]
    stream_compare = [
        ("Broker", "Mobile UX", "Security posture", "PHANTOM fit", "Known issue"),
        ("Guacamole", "good cross-protocol", "broker-visible unless hardened/E2EE added", "intermediate only", "input bridge and clear broker risk"),
        ("KasmVNC", "good for browser VNC/mobile controls", "TLS/session controls, broker still important", "intermediate candidate", "side menu/keyboard UX"),
        ("noVNC", "simple", "depends on transport/session wrapper", "lower", "same keyboard/menu issues possible"),
        ("Custom E2EE/SFrame", "requires build", "best target if keys stay outside broker", "target", "engineering complexity"),
    ]
    evidence_rows = [
        ("E0", "written requirement", "test intent only"),
        ("E1", "static review", "contract and controls"),
        ("E2", "unit/contract tests", "API invariants"),
        ("E3", "integration tests", "multi-module behavior"),
        ("E4", "live metadata probes", "path health and reachability"),
        ("E5", "human/ADB interaction", "actual usability"),
        ("E6", "negative security tests", "boundary enforcement"),
        ("E7", "repeatable regression", "release confidence"),
        ("E8", "human gate", "approval state, not new evidence"),
    ]
    html = [
        '<section class="atlas">',
        '<h1>SECURITY & ARCHITECTURE ATLAS — grafy, macierze, porównania</h1>',
        '<p>Ten atlas jest warstwą wizualną Księgi 4.0. Pokazuje granice zaufania, wektory zagrożeń, przepływy obronne, porównania technologiczne i dowody wymagane do uznania funkcji za działającą. Diagramy są defensywne i audytowe; nie są instrukcjami obchodzenia zewnętrznych systemów kontroli.</p>',
        "".join(diagrams),
        '<h2>A11. Macierz głównych wektorów zagrożeń</h2>',
        _table(["Wektor", "Powierzchnia", "Cel atakującego", "Kontrole", "Dowód/test", "Ryzyko"], threat_rows, "wide"),
        '<h2>A12. STRIDE per komponent</h2>',
        _table(["Komponent", "Spoofing", "Tampering", "Repudiation", "Information disclosure", "DoS", "Elevation"], stride_rows, "wide"),
        '<h2>A13. Kontrole, dowody i ryzyka rezydualne</h2>',
        _table(["Warstwa", "Kontrole", "Dowód", "Ryzyko rezydualne"], controls_rows, "wide"),
        '<h2>A14. Porównanie izolacji workloadów</h2>',
        _table(["Kryterium", "Kontenery", "Firecracker", "Dedicated bare metal", "Confidential computing"], comparisons, "wide"),
        '<h2>A15. Porównanie brokerów streamingu</h2>',
        _table(["Broker", "Mobile UX", "Security posture", "PHANTOM fit", "Known issue"], stream_compare, "wide"),
        '<h2>A16. Hierarchia dowodów testowych</h2>',
        _table(["Poziom", "Dowód", "Co może potwierdzić"], evidence_rows, "wide"),
        '</section>',
    ]
    return "\n".join(html)


def final_comparison_and_admin_deep_dive() -> str:
    comparison_rows = [
        (
            "Charakter dokumentu",
            "Baseline systemowy, wymagania certyfikowalne, architektura stref i kontroli.",
            "Profil wysokiego ryzyka i moduły autonomiczne [A], wymagające osobnej akceptacji.",
            "Księga 4.0 scala traceability 3.4 z profilem PHANTOM, ale rozdziela baseline od [A].",
            "HUMAN GATE dla każdej funkcji PHANTOM, która zmienia baseline.",
        ),
        (
            "Zakres produktu",
            "Bezpieczna platforma komunikacyjna, thin client, Matrix, CDR, G1/G2, HSM/PKI.",
            "Hardening operatora, rotacja, mocniejsza izolacja, profil pracy w środowisku podwyższonego ryzyka.",
            "Panel, portal i operator działają jako produkt; PHANTOM pozostaje profilem kontrolowanym.",
            "Zakaz mieszania claimów PHANTOM z certyfikowalnym core.",
        ),
        (
            "Terminal",
            "Thin client bez danych operacyjnych na urządzeniu końcowym.",
            "Pixel/GrapheneOS jako terminal o podwyższonych wymaganiach admission.",
            "Pixel i laptop są terminalami operatora; dane i aplikacje pozostają w workloadach.",
            "Test: storage check, ADB human regression, session expiry.",
        ),
        (
            "Router",
            "Router dostępowy jako element ścieżki, bez zaufania do danych aplikacyjnych.",
            "Puli AX/validated equivalent jako element admission i policy, z osobnym profilem hardening.",
            "Puli AX jest aktualnym kandydatem wdrożeniowym, dopóki przejdzie kwalifikację sprzętową.",
            "Test: kill switch, DNS leak, restart recovery, route evidence.",
        ),
        (
            "G1/G2",
            "Rozdział gateway i brokera dostępu. Brak bypassu wokół G1/G2.",
            "Ścieżka zaostrzona, broker docelowo ślepy wobec treści streamu.",
            "Każdy operator dostaje indywidualne G1 i G2; workload może być współdzielony lub dedykowany wg tieru.",
            "Test: negative route, session cap, no stream persistence.",
        ),
        (
            "Workload",
            "Izolacja środowisk aplikacji, CDR na granicy plików, minimalizacja lateral movement.",
            "Silniejsza izolacja Firecracker/bare metal/confidential computing w wyższych tierach.",
            "Pilot/Standard mogą korzystać z pul współdzielonych, Pro+ z Firecracker, Phantom/Sovereign z dedykacją wg policy.",
            "Test: recreate proof, VM/container ID change, app usability.",
        ),
        (
            "Aplikacje",
            "Autoryzowane aplikacje i kontrola dostępu przez panel.",
            "Wersje desktop/native oceniane pod kątem izolacji i realnego użycia.",
            "Globalny katalog aplikacji dodaje tylko superadmin; operator wybiera liczbę instancji w ramach tieru.",
            "Test: launcher, stream, input, account-state, limitations explicit.",
        ),
        (
            "CDR",
            "Kontrola transferu plików jako obowiązkowa granica bezpieczeństwa.",
            "CDR pozostaje wymagany, bo PHANTOM nie może polegać na zaufaniu do plików przychodzących.",
            "CDR jest obowiązkowy u każdego operatora, raportowany w admin/SOC jako metadane i decyzje.",
            "Test: malicious corpus, quarantine, hash, allow/deny.",
        ),
        (
            "HSM/FIDO2",
            "HSM/PKI i FIDO2 jako elementy docelowego zaufania i step-up.",
            "FIDO2 staje się krytycznym elementem admission profilu PHANTOM.",
            "UI i modele konfiguracji są wymagane teraz; fizyczne testy HSM/FIDO2 są gate końcowy.",
            "Test: placeholder state, policy deny, later hardware acceptance.",
        ),
        (
            "Rotacja jurysdykcyjna",
            "Rotacja jako polityka infrastruktury i dostępności providerów.",
            "Silniejsza rotacja w profilu wysokiego ryzyka, z akceptacją ryzyka metadanych.",
            "Niższe tiery mogą być przenoszone między istniejącymi zasobami; wyższe mogą dostawać nowe/dedykowane zasoby. Po zwolnieniu zasób wraca do puli dopiero po sanityzacji.",
            "Test: entitlement allow/deny, provider capacity, cleanup proof.",
        ),
        (
            "Portal zakupowy",
            "Poza zakresem starego baseline albo opisany mniej szczegółowo.",
            "Nie jest core PHANTOM, ale wpływa na bootstrap operatora.",
            "Oddzielny publiczny portal obsługuje płatności, tokeny, resellerów i paczki startowe.",
            "Test: signed webhook, token hash, one-time claim, no admin route exposure.",
        ),
        (
            "Panel administratora",
            "Control plane i zarządzanie operatorami/providerami.",
            "Governance, gates, policy i alerty dla funkcji podwyższonego ryzyka.",
            "Admin panel 4.0 jest główną konsolą zarządzania, kosztów, providerów, observability, CDR i incident response.",
            "Test: RBAC, step-up, audit, synthetic anomaly, cost math.",
        ),
        (
            "Panel operatora",
            "Sesja, aplikacje i ustawienia bezpieczeństwa operatora.",
            "Kontrola środowisk, TTL, panic policy, rotacja w ramach entitlement.",
            "Operator panel zarządza własnymi workloadami, sesją, backupem, panic levels, Matrix addon i wyborem wersji aplikacji.",
            "Test: Pixel/laptop human regression, app switching, reset/recreate.",
        ),
        (
            "Monitoring i blue team",
            "Audit, metadane, alarmy, SRE/SOC.",
            "Wzmocnione wykrywanie anomalii i runtime monitoring.",
            "Panel admina obserwuje ścieżkę Pixel/Puli/G1/G2/workload jako metadane, nie treść wiadomości ani streamu.",
            "Test: alert P0-P3, no content capture, incident workflow.",
        ),
        (
            "RF/telecom",
            "Ryzyka telekom i sprzętu opisane jako threat model.",
            "PHANTOM ma ostrzejsze wymagania, ale obszary regulowane są lab-only/governance.",
            "Księga 4.0 opisuje granice i ryzyka, bez instrukcji manipulacji publicznymi identyfikatorami.",
            "HUMAN GATE: counsel/CISO/lab owner.",
        ),
        (
            "Status produkcyjny",
            "Baseline wymaga testów, dowodów i release gates.",
            "PHANTOM wymaga osobnego zatwierdzenia i nie jest domyślnym produktem.",
            "Księga 4.0 jest baseline dokumentacyjnym; funkcja działa dopiero po dowodach E5-E7 i gate.",
            "Nie wolno oznaczać funkcji jako works bez realnego testu.",
        ),
    ]

    admin_nav_rows = [
        ("Dashboard", "Globalny stan systemu, liczba operatorów, tier mix, koszty, alerty, gates, capacity.", "Drill-down do operatora, alertu, providera, kolejki provisioningu.", "Treść wiadomości, seed, hasła, tokeny providerów.", "Playwright dashboard + API health."),
        ("Operators", "Tabela operatorów: status, tier, koszt miesięczny, expiry, G1/G2/workload, terminale, sesje.", "Create from token, suspend, extend, upgrade, rotate, revoke cert, view evidence.", "Treść aplikacji i prywatne dane operatora.", "CRUD + RBAC + audit event."),
        ("Operator Detail", "Timeline sesji, app environments, workload IDs, CDR decisions, path status, cost allocation.", "Prepare/recreate environment, force reauth, issue package, mark incident.", "Sekrety i aktywne hasła.", "Human regression na jednym operatorze testowym."),
        ("Providers", "Hetzner/OVH/inny provider, kraje, API status, ceny, limity, capabilities.", "Add provider, rotate credentials, enable/disable region, qualify KVM/Firecracker/TDX/SEV-SNP.", "Plaintext API secret po zapisaniu.", "Provider capability matrix + secret redaction."),
        ("Subscriptions/Tiers", "Pilot/Standard/Pro/Phantom/Sovereign, ceny, minima, limity aplikacji, rotacja, dedicated rules.", "Edit policy, publish version, simulate entitlement.", "Ręczna zmiana bez wersjonowania.", "Quota enforcement tests."),
        ("Tokens/Billing/Resellers", "Token ledger, payment provider, reseller pool, rabaty, invoice/company metadata.", "Generate token, revoke unclaimed, assign reseller, reconcile webhook.", "Pełne dane karty, prywatne dane portfeli.", "Webhook signature + idempotency."),
        ("Apps Catalog", "Autoryzowane aplikacje, tryby desktop/web/native, wersje, wymagane konta, ograniczenia.", "Add global app, disable app, pin version, mark limited/works/broken.", "Operator nie może dodawać global app.", "App launch and state test."),
        ("Workloads", "Pool bare metal, Firecracker/container inventory, per-operator allocation, health, recreate state.", "Allocate, recreate, quarantine host, drain host, move operator.", "Cross-tenant file or process visibility.", "Isolation and recreate proof."),
        ("Provisioning", "Kolejka tworzenia G1, G2, workload, Pixel package, router package.", "Retry failed step, cancel, resume, inspect safe logs.", "Provider secret, SSH private key material.", "End-to-end operator bootstrap dry run."),
        ("Terminal/Devices", "Pixel/laptop/router inventory, CA state, cert serials, posture, last seen.", "Revoke device, issue package, require re-enroll.", "Local terminal contents.", "Device admission negative tests."),
        ("PKI/HSM/FIDO2", "CA hierarchy, cert issuance, HSM/FIDO2 placeholders, hardware readiness.", "Configure policy, require step-up, later enroll hardware.", "Private keys.", "Policy state and future hardware gate."),
        ("CDR", "File policy, quarantine, allow/deny, hashes, transformations, unsupported formats.", "Change policy, release/quarantine with approval, export evidence.", "File content preview unless policy-approved analysis sandbox.", "Malicious corpus tests."),
        ("Monitoring/SOC", "Path health, tunnel flaps, auth failures, key changes, provider errors, anomaly score.", "Acknowledge alert, create incident, isolate component, request rebuild.", "Message content or pixel stream capture.", "Synthetic alert P0-P3."),
        ("Incident Response", "Incident board, severity, owners, containment actions, evidence chain.", "Contain, revoke, rotate, rebuild, close with postmortem.", "Destructive action without gate.", "IR tabletop + dry-run."),
        ("Audit/WORM", "Immutable audit events, admin actions, policy versions, token claims, provider calls.", "Search, export evidence, verify tamper proof.", "Editable audit history.", "Tamper negative test."),
        ("PHANTOM Governance", "Human gates, lab-only records, residual risks, exception register.", "Open/close gate, attach approval, block execution.", "Operational restricted SOP in product UI.", "Gate must block unsafe execution."),
        ("Release Gates", "Production readiness by module, test evidence E0-E8, known blockers.", "Promote/demote feature state.", "Works label without E5/E6 evidence.", "Release checklist audit."),
    ]

    admin_workflow_rows = [
        ("Create operator from token", "Portal token claimed -> admin verifies tier -> provisioning plan -> G1/G2/workload -> Pixel/Puli packages -> operator first login.", "Admin can retry failed step; cannot bypass entitlement.", "token hash, plan ID, provision IDs, package hashes, audit event."),
        ("Provider onboarding", "Add provider metadata -> add secret via vault path -> qualify countries/capabilities -> run test provision -> mark region available.", "Secret never re-displayed; destructive changes require step-up.", "capability report, API health, cost template."),
        ("Tier change", "Select operator -> simulate new cost/quota -> approve -> apply subscription policy version -> update quotas and rotation rights.", "Downgrade cannot orphan running environments silently.", "old/new policy, cost delta, quota result."),
        ("Jurisdiction rotation", "Operator request or schedule -> entitlement check -> provider capacity -> allocate target -> migrate/recreate -> verify path -> release old resource after cleanup.", "Lower tier can reuse sanitized pool; higher tier may require new/dedicated resources.", "route evidence, cleanup proof, allocation event."),
        ("Workload recreate", "Operator clicks prepare new session or admin forces rebuild -> stop old env -> cleanup -> start new env -> verify stream/input.", "Must change runtime ID and fail if stream is not usable.", "old/new IDs, health check, human test state."),
        ("Authorized app lifecycle", "Superadmin adds app -> security review -> version pin -> workload image update -> operator entitlement -> launch tests.", "Operator may create own instances only within approved app and quota.", "app manifest, version, test evidence."),
        ("Incident containment", "Alert -> severity -> owner -> containment action -> evidence preservation -> rebuild/revoke -> postmortem.", "No panic/full destroy without pre-approved legal policy.", "incident ID, timestamps, approvals, actions."),
        ("Device revoke", "Lost Pixel/laptop/router -> revoke cert -> invalidate sessions -> require package regeneration -> verify old device denied.", "Current session must end at once.", "cert serial, deny test, new package hash."),
    ]

    observation_rows = [
        ("Path map", "Pixel/Puli AX/G1/G2/workload status, tunnel up/down, latency bands, last seen.", "Route break, direct bypass attempt, unexpected path change.", "No payload, no message content, no pixel recording."),
        ("Cost and capacity", "Per-operator monthly cost, bare-metal pool share, G1/G2 VPS cost, transfer, storage.", "Cost spike, over-quota app count, underutilized host.", "No payment card secrets."),
        ("Session security", "Session TTL, unlock state, failed reauth, device posture.", "Repeated failed unlock, expired session still active, device mismatch.", "No passwords/FIDO private material."),
        ("Provider health", "API status, rate limits, provision failures, region capacity.", "Provider outage, credential failure, region depletion.", "No secret value display."),
        ("CDR telemetry", "File type, hash, allow/deny/quarantine, transform result.", "Quarantine spike, unknown format, suspicious source.", "No file preview by default."),
        ("Workload health", "Runtime state, CPU/RAM, stream reachable, app state works/limited/broken.", "Crash loop, black screen, input failure, recreate failure.", "No app content logs."),
        ("Anomaly scoring", "Weighted score from auth, route, key, CDR, provider, runtime and cost signals.", "P0-P3 alert, incident creation, forced reauth.", "Score explanations are metadata only."),
        ("Audit analytics", "Admin action sequence, policy version changes, approval chain.", "Four-eyes bypass attempt, unusual admin pattern.", "No mutable audit records."),
    ]

    admin_detail_rows = [
        ("Operatorzy", "tier, expiry, status, G1/G2/workload, cost, last session, risk", "create/suspend/upgrade/rotate/revoke", "content, passwords, seeds", "table filters + RBAC"),
        ("Providerzy", "countries, capabilities, prices, health, capacity", "add/edit/disable/qualify", "secret after save", "secret redaction + region test"),
        ("Subskrypcje", "price, minimum term, quota, rotation rights, dedicated rules", "version policy, simulate impact", "unversioned manual mutation", "entitlement tests"),
        ("Monitoring", "metadata, alert score, path health, incident status", "ack/isolate/rebuild/revoke", "payload and stream content", "synthetic anomaly"),
        ("CDR", "decision, hash, file type, transform, quarantine", "release/quarantine/change policy", "file content by default", "malicious corpus"),
        ("PHANTOM", "gates, approvals, residual risks, lab-only records", "open/close gate, block unsafe feature", "restricted operational SOP", "gate deny test"),
    ]

    slo_rows = [
        ("Admin dashboard load", "p95 < 2.5s", "browser synthetic", "P2 if exceeded 3 consecutive runs"),
        ("Operator create plan", "< 30s to plan, provisioning async", "API timing", "P1 if token claim blocked"),
        ("G1/G2 tunnel uptime", ">= 99.5% pilot, higher tiers by SLA", "metadata probes", "P1 if active operator affected"),
        ("Workload recreate", "< 5 min container, < 15 min Firecracker target after image cached", "runtime event timestamps", "P1 if failed twice"),
        ("Stream usability", "visible image + input + scroll + app switch", "ADB/laptop human regression", "P0 for active production app unusable"),
        ("CDR queue", "p95 < 60s for supported files", "queue metrics", "P2 if delay without operator impact"),
        ("Alert MTTD", "< 60s for P0/P1 synthetic signals", "SIEM test", "P1 if missed"),
        ("Audit write", "100% admin actions produce WORM event", "audit test", "P0 if missing destructive action event"),
    ]

    admin_fig = base.svg(
        [
            {"id": "dash", "label": "Admin Dashboard\nstate, cost, risk", "x": 35, "y": 85, "w": 190, "h": 80, "fill": "#eef5ff"},
            {"id": "ops", "label": "Operators\nG1/G2/workload", "x": 285, "y": 85, "w": 190, "h": 80},
            {"id": "prov", "label": "Providers\ncountries/capabilities", "x": 535, "y": 85, "w": 210, "h": 80},
            {"id": "tiers", "label": "Subscriptions\nquotas/rotation", "x": 805, "y": 85, "w": 210, "h": 80},
            {"id": "queue", "label": "Provisioning Queue\nplans and retries", "x": 285, "y": 270, "w": 220, "h": 85, "fill": "#eef8f4"},
            {"id": "soc", "label": "Monitoring/SOC\nmetadata only", "x": 565, "y": 270, "w": 220, "h": 85, "fill": "#fff8e8", "stroke": "#e0a100"},
            {"id": "audit", "label": "Audit/WORM\nimmutable evidence", "x": 845, "y": 270, "w": 190, "h": 85, "fill": "#fff8e8", "stroke": "#e0a100"},
        ],
        [
            ("dash", "ops", "drilldown"),
            ("ops", "queue", "provision/recreate"),
            ("prov", "queue", "capacity"),
            ("tiers", "ops", "entitlement"),
            ("queue", "soc", "events"),
            ("soc", "audit", "incident/evidence"),
            ("ops", "audit", "admin action"),
            ("prov", "audit", "provider change"),
        ],
        "Z1. Panel administratora - zarządzanie, provisioning, obserwacja",
    )
    soc_fig = base.svg(
        [
            {"id": "g1", "label": "G1\nVPN metadata", "x": 45, "y": 90, "w": 170, "h": 75},
            {"id": "g2", "label": "G2\nsession metadata", "x": 45, "y": 205, "w": 170, "h": 75},
            {"id": "wl", "label": "Workload\nruntime health", "x": 45, "y": 320, "w": 170, "h": 75},
            {"id": "cdr", "label": "CDR\nfile decisions", "x": 280, "y": 150, "w": 190, "h": 85, "fill": "#fff8e8", "stroke": "#e0a100"},
            {"id": "norm", "label": "Normalizer\nschema + tenant", "x": 535, "y": 150, "w": 200, "h": 85, "fill": "#eef5ff"},
            {"id": "score", "label": "Anomaly Engine\nP0-P3 score", "x": 790, "y": 150, "w": 220, "h": 85, "fill": "#fdeeee", "stroke": "#b42318"},
            {"id": "ir", "label": "Incident Board\ncontain/rebuild/revoke", "x": 535, "y": 315, "w": 260, "h": 85, "fill": "#eef8f4", "stroke": "#25a18e"},
        ],
        [
            ("g1", "norm", "events"),
            ("g2", "norm", "events"),
            ("wl", "norm", "events"),
            ("cdr", "norm", "decisions"),
            ("norm", "score", "features"),
            ("score", "ir", "alert"),
            ("ir", "norm", "postmortem"),
        ],
        "Z2. Blue-team observation - metadane bez treści operatora",
    )

    return "\n".join([
        '<section class="appendix-final">',
        '<h1>ZAŁĄCZNIK Z - Końcowe porównanie i panel administratora</h1>',
        '<p>Ten załącznik odpowiada na pytanie, co realnie zmieniło się między Księgą 3.4 FIXED, PHANTOM v3.0 i Księgą 4.0. Jest umieszczony na końcu dokumentu jako tabela kontrolna dla developerów, architektów, SOC i osób odbierających system.</p>',
        '<h2>Z1. Księga 3.4 FIXED vs PHANTOM v3.0 vs Księga 4.0</h2>',
        _table(["Obszar", "Księga 3.4 FIXED", "PHANTOM v3.0", "Decyzja Księgi 4.0", "Gate/test"], comparison_rows, "wide"),
        '<h2>Z2. Panel administratora - mapa informacyjna</h2>',
        admin_fig,
        '<p>Panel administratora jest konsolą zarządzania systemem, nie aplikacją do pracy operatora. Ma dawać kontrolę nad operatorami, providerami, subskrypcjami, provisioningiem, monitoringiem, CDR, incident response i kosztami. Jego podstawową zasadą jest: widzieć stan i metadane, ale nie widzieć treści pracy operatora.</p>',
        _table(["Zakładka", "Co pokazuje", "Akcje", "Czego nie pokazuje", "Test odbiorczy"], admin_nav_rows, "wide"),
        '<h2>Z3. Zarządzanie - główne workflow administratora</h2>',
        _table(["Workflow", "Przebieg", "Reguły bezpieczeństwa", "Dowody"], admin_workflow_rows, "wide"),
        '<h2>Z4. Obserwacja i analiza blue-team</h2>',
        soc_fig,
        _table(["Obszar obserwacji", "Co mierzymy", "Co analizujemy", "Zakaz"], observation_rows, "wide"),
        '<h2>Z5. Uprawnienia, widoczność i testy panelu admina</h2>',
        _table(["Moduł", "Admin widzi", "Admin może", "Admin nie widzi/nie może", "Test"], admin_detail_rows, "wide"),
        '<h2>Z6. KPI/SLO i kryteria uznania funkcji za działającą</h2>',
        _table(["Kryterium", "Cel", "Źródło dowodu", "Alert"], slo_rows, "wide"),
        '<h2>Z7. Zasady akceptacji</h2>',
        '<ul>',
        '<li>Funkcja nie może mieć statusu works, jeżeli nie ma dowodu E5 lub E6 tam, gdzie wymagany jest realny test człowieka albo test granicy bezpieczeństwa.</li>',
        '<li>Panel admina nie może przechowywać ani wyświetlać sekretów po zapisie. Każdy sekret ma być oznaczony jako configured/not configured, z fingerprintem lub identyfikatorem bez wartości.</li>',
        '<li>Monitoring nie może rejestrować treści wiadomości, seedów walletów, haseł, kodów SMS, kluczy prywatnych ani prywatnej zawartości plików operatora.</li>',
        '<li>Operacje destrukcyjne, panic policy, provider secret rotation, PHANTOM gate i działania IR wymagają niezmiennego wpisu audytowego.</li>',
        '<li>Obszary regulowane PHANTOM/RF/telecom pozostają w Księdze jako threat model, governance, lab-only i human gate; nie są instrukcją operacyjną ani domyślną funkcją produktu.</li>',
        '</ul>',
        '</section>',
    ])


def tiered_threat_analysis_appendix() -> str:
    posture_rows = [
        (
            "Pilot",
            "Podstawowa izolacja operatora, indywidualne G1/G2, mała liczba środowisk aplikacyjnych.",
            "Ataki masowe, typowe malware plikowe przez CDR, podstawowe przejęcie sesji, błąd operatora.",
            "Współdzielona pula workloadów, mniejsza rotacja, większa ekspozycja na metadane i awarie providerów.",
            "Ma być bezpieczny funkcjonalnie, ale nie jest profilem dla przeciwnika państwowego.",
        ),
        (
            "Standard",
            "Więcej środowisk aplikacyjnych, lepsze entitlement, bardziej kompletne monitoring/CDR.",
            "Większość błędów operacyjnych, nadużycia tokenów, typowe próby lateral movement.",
            "Nadal może korzystać ze współdzielonych zasobów workload; rotacja głównie po istniejących pulach.",
            "Dobry poziom dla normalnych operatorów; nie obiecuje pełnej odporności na globalną korelację.",
        ),
        (
            "Pro",
            "Firecracker jako cel dla środowisk wysokiego ryzyka, większe limity aplikacji, mocniejsza rotacja.",
            "Eksploity aplikacji, ucieczka z kontenera ograniczana przez microVM, częstsza przebudowa środowisk.",
            "Ryzyko hosta workload i providera nadal istnieje; wymaga dowodów izolacji i recreate.",
            "Pierwszy tier, w którym ochrona workloadu powinna być traktowana jako istotna granica bezpieczeństwa.",
        ),
        (
            "Phantom",
            "Profil [A]: silniejsze admission terminal/router/FIDO2, dedykacja wybranych zasobów, PHANTOM gates.",
            "Targeted compromise, silniejsza analiza metadanych, broker/session compromise, supply-chain risk.",
            "Nie jest certyfikowalnym core; wymaga human gate, legal review i jawnego residual-risk acceptance.",
            "Broni szerzej niż Pro, ale nie wolno opisywać go jako pełnej anonimowości albo gwarancji niewykrywalności.",
        ),
        (
            "Sovereign",
            "Najszerszy profil: najwyższa dedykacja, własne lub kwalifikowane zasoby, BYO-HSM/KMS, mocne gates.",
            "Ataki providera, insider, supply chain, zaawansowana korelacja, presja prawna i awarie jurysdykcyjne.",
            "Nie usuwa ryzyka RF, fizycznego, błędu człowieka ani globalnej korelacji. Zmniejsza blast radius i zależność od współdzielonej infrastruktury.",
            "Najmocniejszy tier; nadal wymaga operacyjnej dyscypliny, testów E5-E7 i akceptacji ryzyka.",
        ),
    ]

    scenario_rows = [
        (
            "Kradzież albo przejęcie terminala",
            "Atakujący uzyskuje fizyczny dostęp do Pixela/laptopa albo aktywną sesję przeglądarki.",
            "Session TTL, brak danych aplikacyjnych lokalnie, cert revoke, forced reauth.",
            "To samo plus krótsze TTL, mocniejsze device posture, opcjonalne wymuszenie FIDO2.",
            "PHANTOM admission: terminal/router/FIDO2 muszą spełnić policy; Sovereign wymaga najściślejszego revoke i evidence.",
            "Aktywna odblokowana sesja może ujawnić aktualny widok do czasu wygaszenia/reakcji.",
            "ADB/laptop test: revoke device -> stara sesja traci dostęp.",
        ),
        (
            "Podłożona sieć Wi-Fi / rogue access path",
            "Atakujący próbuje skierować terminal poza oczekiwaną ścieżkę albo przez fałszywy punkt dostępu.",
            "Terminal używa dopuszczonego profilu, VPN do G1, route negative tests.",
            "Dodatkowe posture checks i alerty direct-bypass.",
            "Phantom/Sovereign wymagają silniejszego powiązania terminal-router-policy i blokady sesji przy naruszeniu ścieżki.",
            "Ryzyko RF i konfiguracji użytkownika pozostaje; nie wszystko da się zweryfikować wyłącznie softwarem.",
            "Test: Pixel/Puli -> G1/G2 only, direct route denied, DNS leak denied.",
        ),
        (
            "Kompromitacja routera dostępowego",
            "Router zostaje przejęty albo błędnie skonfigurowany, próbuje podsłuchu, DNS leak albo bypass.",
            "Kill switch, DNS leak prevention, tunel do G1, brak danych aplikacyjnych w routerze.",
            "Więcej telemetryki, alerty tunnel flap i route mismatch.",
            "Phantom/Sovereign nie ufają routerowi jako miejscu przechowywania danych; router jest elementem admission, nie właścicielem sekretów workloadu.",
            "Baseband/firmware routera i WAN metadata pozostają ryzykiem.",
            "Test: restart routera, brak tunelu = brak internetu dla ścieżki operatora.",
        ),
        (
            "Kompromitacja G1",
            "Atakujący próbuje pivotować z gateway do G2 albo zdobyć dane operatora.",
            "G1 indywidualne per operator, brak danych aplikacyjnych, minimal services, rebuild/revoke.",
            "Szybsze rebuildy i alerty metadanych.",
            "Phantom/Sovereign preferują ostrzejszą izolację, krótsze życie certów i mocniejszy incident workflow.",
            "G1 nadal widzi metadane tunelu i może być punktem DoS.",
            "Test: G1 compromised drill -> revoke cert, rebuild, direct app data absent.",
        ),
        (
            "Kompromitacja G2 / brokera sesji",
            "Atakujący uzyskuje dostęp do brokera streamingu i próbuje podejrzeć lub przejąć aktywną sesję.",
            "Session caps, no persistence, RBAC, monitoring, storage/log check.",
            "Preferencja Firecracker/workload isolation i twardsze limity sesji.",
            "Phantom/Sovereign docelowo wymagają blind broker/E2EE stream; jeśli broker widzi stream, status musi być residual high.",
            "Aktywna sesja może być ryzykiem do czasu wdrożenia blind-broker target.",
            "Test: no stream persistence + session cap + broker compromise tabletop.",
        ),
        (
            "Exploit aplikacji komunikatora",
            "Błąd w Signal/Telegram/WhatsApp/Threema/Zangi/DuckDuckGo/LibreOffice/Exodus daje kod w środowisku aplikacji.",
            "Izolowane środowisko, recreate, CDR dla plików, brak lokalnych danych terminala.",
            "Pro używa Firecracker jako oczekiwanej granicy dla mocniejszych środowisk.",
            "Phantom/Sovereign wymagają najściślejszej izolacji, pinowania wersji, evidence app-state i szybkiego rebuild.",
            "Jeśli exploit ucieknie z VM/hosta, potrzebny jest incident response i host quarantine.",
            "Test: app crash/recreate, old runtime ID != new runtime ID, no cross-app visibility.",
        ),
        (
            "VM/container escape z workloadu",
            "Atakujący wychodzi z kontenera albo microVM na hosta i próbuje dostać się do innych operatorów.",
            "Pilot/Standard: ograniczenia kontenera i network policy; residual risk wyższy.",
            "Pro: Firecracker jako wymagana redukcja ryzyka dla bardziej wrażliwych środowisk.",
            "Phantom/Sovereign: dedykacja hosta lub mocniejsze hardware isolation, monitoring runtime, host quarantine.",
            "Żadna warstwa nie eliminuje całkowicie ryzyka 0-day w VMM/kernel.",
            "Test: lab-only escape simulation, runtime syscall alert, tenant isolation negative test.",
        ),
        (
            "Złośliwy plik albo załącznik",
            "Plik z makrem, exploitem dokumentu, payloadem albo steganografią trafia do operatora.",
            "CDR obowiązkowy, unsupported formats blocked, quarantine, hash.",
            "Tak samo, z mocniejszymi policy i większą obserwacją anomalii.",
            "Phantom/Sovereign wymagają surowszych reguł release z quarantine i lepszego evidence chain.",
            "CDR nie daje absolutnej skuteczności wobec wszystkich formatów i technik evasion.",
            "Test: corpus DOCX/PDF/archive/image, allow/deny/quarantine verified.",
        ),
        (
            "Provider snapshot / insider providera",
            "Provider próbuje snapshotu, obserwacji metadanych, manipulacji hostem albo działa pod presją prawną.",
            "Szyfrowanie, minimalny stan, osobne G1/G2 per operator, audyt.",
            "Większe tiery mają mocniejszą rotację i mniejszy współdzielony blast radius.",
            "Sovereign ma najszerszy model: dedykowane/kwalifikowane zasoby, BYO-HSM/KMS, możliwość osobnego autonomous perimeter.",
            "Provider nadal widzi część metadanych infrastruktury, a fizyczny atak/supply chain pozostaje residual.",
            "Test: provider capability review, encryption-at-rest evidence, key ownership review.",
        ),
        (
            "Przejęcie konta administratora",
            "Atakujący uzyskuje sesję admina i próbuje zmieniać providerów, subskrypcje, operatorów albo policy.",
            "RBAC, step-up, WORM audit, no secret redisplay.",
            "Four-eyes dla operacji destrukcyjnych i provider secret rotation.",
            "Phantom/Sovereign wymagają human gates i explicit risk acceptance dla zmian krytycznych.",
            "Autoryzowany insider nadal może wykonać część działań w swoim zakresie.",
            "Test: permission matrix, step-up negative test, immutable audit for destructive action.",
        ),
        (
            "Token/payment/reseller fraud",
            "Fałszywy webhook, replay tokenu, reseller generuje nadmiarowe kody albo próbuje ominąć tier.",
            "Webhook signatures, token hash, one-time claim, idempotency.",
            "Limity resellerów, reconciliation, token scope per tier.",
            "Phantom/Sovereign wymagają dodatkowej weryfikacji przed aktywacją pełnych zasobów.",
            "Ryzyko socjotechniki i płatności poza systemem pozostaje procesowe.",
            "Test: webhook replay, double claim, reseller quota denial.",
        ),
        (
            "Nadużycie rotacji jurysdykcyjnej",
            "Operator albo błąd systemu próbuje rotacji poza entitlement, do niedozwolonego kraju albo na nieoczyszczony zasób.",
            "Entitlement deny, provider capability registry, cleanup proof before reuse.",
            "Pro ma częstsze i bardziej elastyczne rotacje; nadal przez policy.",
            "Phantom/Sovereign mogą używać dedykowanych zasobów i wymagają mocniejszego evidence dla migracji.",
            "Rotacja nie ukrywa wszystkich metadanych i nie zastępuje legal review.",
            "Test: deny unauthorized country, sanitize old resource, route evidence.",
        ),
        (
            "Matrix federation / własny serwer Matrix",
            "Źle skonfigurowana federacja ujawnia metadane, spamuje albo pozwala na nadużycie serwera.",
            "Matrix addon opcjonalny, policy federation, CDR dla plików.",
            "Większe tiery dostają lepszą izolację i monitoring serwera Matrix.",
            "Phantom/Sovereign wymagają osobnej analizy metadanych i legal/compliance review dla konfiguracji sieci.",
            "Metadane federacji i zachowanie użytkowników mogą korelować operatora.",
            "Test: federation policy, abuse scenario, metadata review.",
        ),
        (
            "Backup exfiltration albo błędny restore",
            "Atakujący próbuje pobrać backup operatora albo przywrócić go do złego środowiska.",
            "Encrypted backup, ownership binding, audit, no admin content view.",
            "Większe tiery: mocniejsze retention i restore gates.",
            "Phantom/Sovereign: silniejszy key ownership, HSM/KMS policy, restoration approval.",
            "Błąd operatora przy eksporcie pozostaje ryzykiem.",
            "Test: restore to wrong operator denied, backup decrypt requires correct owner policy.",
        ),
        (
            "DDoS albo awaria dostępności",
            "Atakujący degraduje portal, G1/G2, provider API albo workload pool.",
            "Rate limits, health checks, retry queues, fail-safe session states.",
            "Większe tiery: większa separacja capacity i szybszy rebuild.",
            "Sovereign ma najszerszą odporność przez dedykowane zasoby i możliwość alternatywnych providerów/perimeter.",
            "Dostępność nigdy nie jest absolutna; nation-state scale może degradować łączność.",
            "Test: provider outage simulation, queue retry, graceful denial.",
        ),
    ]

    control_depth_rows = [
        ("Terminal no-data", "Tak", "Tak", "Tak", "Tak + admission", "Tak + najostrzejsze admission"),
        ("Indywidualne G1/G2", "Tak", "Tak", "Tak", "Tak", "Tak"),
        ("CDR obowiązkowy", "Tak", "Tak", "Tak", "Tak", "Tak"),
        ("Workload pool", "Współdzielony", "Współdzielony", "Firecracker preferowany", "Częściowo dedykowany", "Dedykowany/kwalifikowany"),
        ("Jurisdiction rotation", "Ograniczona/pool", "Pool + policy", "Częstsza/policy", "Zaawansowana/human gate", "Najszersza/dedykowane zasoby"),
        ("HSM/FIDO2", "Opcjonalne/roadmap", "Opcjonalne/roadmap", "Wymuszane dla akcji krytycznych", "Element admission", "Wymagane w docelowym profilu"),
        ("Provider risk", "Akceptowany", "Redukowany", "Redukowany przez izolację", "Redukowany przez dedykację", "Najmocniej redukowany przez BYO-HSM/KMS i perimeter"),
        ("Blue-team visibility", "Podstawowa", "Rozszerzona", "Pełna metadata observability", "Pełna + gates", "Pełna + governance + evidence chain"),
        ("Residual risk wording", "Średnie/wysokie", "Średnie", "Średnie dla hosta/providera", "Wysokie scenariusze wymagają akceptacji", "Nadal istnieje: RF, fizyczne, globalna korelacja, człowiek"),
    ]

    scenario_flow = base.svg(
        [
            {"id": "attacker", "label": "Adversary\nphishing, exploit, provider, RF", "x": 35, "y": 85, "w": 205, "h": 90, "fill": "#fdeeee", "stroke": "#b42318"},
            {"id": "path", "label": "Attack Path\nterminal / router / G1 / G2 / workload", "x": 300, "y": 85, "w": 250, "h": 90},
            {"id": "tier", "label": "Tier Policy\nPilot -> Sovereign", "x": 610, "y": 85, "w": 205, "h": 90, "fill": "#eef5ff"},
            {"id": "controls", "label": "Controls\nisolation, CDR, RBAC, HSM, rotation", "x": 300, "y": 275, "w": 285, "h": 95, "fill": "#eef8f4", "stroke": "#25a18e"},
            {"id": "evidence", "label": "Evidence\nE5 human, E6 boundary, E7 regression", "x": 650, "y": 275, "w": 300, "h": 95, "fill": "#fff8e8", "stroke": "#e0a100"},
        ],
        [
            ("attacker", "path", "attempt"),
            ("path", "tier", "scope"),
            ("tier", "controls", "selects"),
            ("controls", "evidence", "must prove"),
            ("evidence", "tier", "release gate"),
        ],
        "Y1. Threat scenarios resolved by tier, controls and evidence",
    )
    scenario_cards = [
        (
            f"Scenariusz ataku: {scenario}",
            [
                ("Ścieżka ataku", attack_path),
                ("Pilot / Standard", low_tiers),
                ("Pro", pro),
                ("Phantom / Sovereign", high_tiers),
                ("Ryzyko rezydualne", residual),
                ("Dowód i test", evidence),
                ("Wymagany zapis w panelu admina", "Alert albo test musi być widoczny w Monitoring/SOC z timestamp, operator_id, affected component, severity, action owner i statusem postmortem. Panel nie pokazuje treści operatora ani sekretów."),
                ("Reguła statusu", "Dopóki test nie przejdzie na realnej ścieżce albo w kontrolowanym labie, scenariusz pozostaje status=partial/blocked i nie może być opisany jako fully protected."),
            ],
        )
        for scenario, attack_path, low_tiers, pro, high_tiers, residual, evidence in scenario_rows
    ]

    return "\n".join([
        '<section class="appendix-threats">',
        '<h1>ZAŁĄCZNIK Y - Scenariusze ataków i obrona per tier</h1>',
        '<p>Ten aneks opisuje scenariusze ataków w stylu analizy zagrożeń: ścieżka ataku, kontrola obronna, różnica między tierami, ryzyko rezydualne i dowód wymagany do uznania kontroli za działającą. Sovereign ma najszerszą ochronę, ale nie jest opisany jako absolutna anonimowość, niewykrywalność ani brak ryzyka.</p>',
        scenario_flow,
        '<h2>Y1. Postura bezpieczeństwa tierów</h2>',
        _table(["Tier", "Główna postawa obronna", "Przed czym broni najlepiej", "Ryzyka rezydualne", "Wniosek"], posture_rows, "wide"),
        '<h2>Y2. Głębokość kontroli per tier</h2>',
        _table(["Kontrola", "Pilot", "Standard", "Pro", "Phantom", "Sovereign"], control_depth_rows, "wide"),
        '<h2>Y3. Scenariusze ataków, obrona i testy</h2>',
        _table(["Scenariusz", "Ścieżka ataku", "Pilot/Standard", "Pro", "Phantom/Sovereign", "Ryzyko rezydualne", "Dowód/test"], scenario_rows, "wide"),
        '<h2>Y4. Szczegółowe karty scenariuszy ataku</h2>',
        '<p>Tabela Y3 jest szybkim porównaniem. Karty Y4 są wersją operacyjną: każda wskazuje, co musi być widoczne w panelu admina, gdzie kończy się ochrona danego tieru i jaki dowód jest wymagany.</p>',
        _detail_cards(scenario_cards, "risk-card"),
        '<h2>Y5. Reguła interpretacji</h2>',
        '<ul>',
        '<li>Pilot i Standard mają chronić przed typowymi błędami, malware, nadużyciami tokenów, podstawowym session abuse i izolować operatorów przez G1/G2 oraz CDR.</li>',
        '<li>Pro jest pierwszym tierem, w którym Firecracker i silniejsza izolacja workloadu powinny być traktowane jako istotny mechanizm redukcji ryzyka, a nie tylko optymalizacja infrastruktury.</li>',
        '<li>Phantom jest profilem [A] z dodatkowymi gates, admission i wymaganiami operacyjnymi; nie należy go mieszać z baseline marketingowym.</li>',
        '<li>Sovereign broni najszerzej, bo minimalizuje współdzielenie zasobów, wzmacnia kontrolę kluczy, ogranicza zależność od providera i wymaga najpełniejszego evidence chain.</li>',
        '<li>Żaden tier nie usuwa ryzyka aktywnie skompromitowanego terminala, błędu człowieka, fizycznego przejęcia sprzętu, globalnej korelacji metadanych ani supply-chain bez dodatkowego programu kontroli.</li>',
        '</ul>',
        '</section>',
    ])


def portal_commerce_token_appendix() -> str:
    perspective_rows = [
        (
            "B2C privacy-first",
            "Użytkownik prywatny kupuje token bez klasycznego konta klienta. Portal pokazuje tier, cenę roczną, dodatki, ograniczenia i ryzyka prywatności.",
            "Zakup crypto lub karta/alternatywna metoda przez PSP, odbiór tokenu, wpisanie tokenu w claim flow, pobranie paczki Pixel/Puli AX albo aktywacja sprzętu od resellera.",
            "Brak konta email-first. Odzyskanie dostępu przez recovery seed/operator wallet seed, jeżeli użytkownik go sam zapisał. Portal nie przechowuje seed.",
            "Nie wolno obiecywać anonimowości. PSP, blockchain, bank albo reseller mogą posiadać własne dane i obowiązki prawne.",
        ),
        (
            "B2B company",
            "Firma kupuje subskrypcję, chce fakturę, VAT, dane nabywcy, możliwość wielu tokenów i rozliczalność.",
            "Wybór tieru, dane firmy, checkout/invoice, tokeny dla operatorów, panel rozliczeniowy albo eksport faktur.",
            "Odzyskanie przez firmowy proces finansowy i uprawnionego reprezentanta, nie przez prywatny seed operatora.",
            "B2B ma więcej danych osobowych/firmowych i dłuższą retencję księgową. Prywatność jest mniejsza niż w ścieżce crypto/private.",
        ),
        (
            "Reseller",
            "Partner kupuje pule tokenów z rabatem, może sprzedawać skonfigurowany Pixel/Puli AX i przekazać paczki startowe.",
            "Reseller console: batch order, rabat 20%, inventory tokenów, status unclaimed/claimed/expired, download paczek tylko dla tokenów przypisanych.",
            "Reseller nie zna sekretów operatora, FIDO2, HSM ani recovery seed klienta. Może mieć tylko dane handlowe i sprzętowe.",
            "Wymaga umowy, KYC/KYB resellera, limitów, audytu i możliwości odcięcia puli tokenów przy nadużyciu.",
        ),
        (
            "Admin / finance",
            "Zespół wewnętrzny rozlicza płatności, webhooki, tokeny, resellerów, faktury i spójność z provisioningiem.",
            "Monitoring płatności, reconciliation, ręczne oznaczenie sporu, revoke unclaimed token, retry webhook, export księgowy.",
            "Admin nie widzi pełnych danych kart, seedów, prywatnych kluczy ani sekretów operatora.",
            "Każda ręczna ingerencja w token albo płatność wymaga WORM audit i powiązania z payment event.",
        ),
    ]

    gateway_rows = [
        (
            "Stripe",
            "Główna bramka kart, walletów i metod lokalnych; używać Stripe Checkout/Payment Element i oficjalnych webhooków.",
            "Karty, portfele i lokalne metody zależne od kraju, waluty i konfiguracji konta. Stablecoin/crypto tylko jeśli dostępne po onboardingu i prawnie zatwierdzone.",
            "Webhook signature verification, idempotency key, fetch payment/session from Stripe API before token mint.",
            "Nie przechowywać danych kart w SYLION. PCI scope ma pozostać po stronie Stripe-hosted UI.",
        ),
        (
            "CoinGate",
            "Primary crypto payment adapter dla BTC/ETH/LN/stablecoin i innych walut obsługiwanych przez providera.",
            "Crypto checkout/order API, statusy płatności, settlement zgodnie z konfiguracją merchant.",
            "Callback/webhook verification, paid/confirmed status, exchange-rate lock window, under/overpayment handling.",
            "Crypto nie oznacza pełnej anonimowości. Blockchain i provider mogą umożliwiać korelację i compliance review.",
        ),
        (
            "Mollie",
            "Backup PSP dla UE i metod lokalnych, szczególnie gdy Stripe jest niedostępny albo wymagana jest metoda lokalna.",
            "Hosted checkout, karty, przelewy i metody regionalne zależne od kraju i aktywacji.",
            "Webhook + API status verification, idempotency, payment state machine.",
            "Mollie jest fallback, ale nie może generować innego tokenu dla tego samego order bez ledger lock.",
        ),
        (
            "Manual/invoice wire",
            "Opcja B2B enterprise, gdy firma wymaga faktury pro-forma, przelewu lub procurement process.",
            "Token generowany dopiero po ręcznym/księgowym potwierdzeniu płatności albo po zatwierdzonej polityce kredytu.",
            "Four-eyes dla ręcznego paid override, dokument księgowy, WORM audit.",
            "Nie używać dla B2C automatycznego self-service bez procedury antyfraud.",
        ),
    ]

    token_type_rows = [
        (
            "BOOTSTRAP",
            "Pierwsze utworzenie operatora.",
            "tier, okres minimum 12 miesięcy, limity aplikacji, entitlement rotacji, provider policy, hardware package policy.",
            "Jednorazowy. Po claimie przechodzi w provisioning_pending/active.",
            "Tworzy operatora, G1/G2, workload plan, paczki Pixel/Puli AX i stan pierwszego logowania.",
        ),
        (
            "RENEWAL",
            "Przedłużenie subskrypcji.",
            "operator_id albo recovery identity, okres, cena, data ważności.",
            "Jednorazowy, możliwy tylko dla istniejącego operatora.",
            "Wydłuża expiry, nie zmienia tieru ani infrastruktury poza billing state.",
        ),
        (
            "UPGRADE",
            "Podniesienie tieru.",
            "old_tier, new_tier, cost delta, nowe limity, wymagane migracje zasobów.",
            "Jednorazowy, wymaga symulacji kosztu i capacity przed apply.",
            "Uruchamia zmianę entitlement i opcjonalną migrację workload/puli.",
        ),
        (
            "ADDON_JURISDICTION",
            "Dokupienie rotacji, kraju albo capacity.",
            "kraje, częstotliwość, provider allowlist, liczba rotacji lub okres.",
            "Zużywalny albo okresowy, zależnie od produktu.",
            "Zwiększa policy rotacji w panelu operatora bez zmiany bazowego tieru.",
        ),
        (
            "ADDON_APP_CAPACITY",
            "Dokupienie dodatkowych środowisk aplikacyjnych.",
            "liczba środowisk, app families, tryb desktop/native, okres.",
            "Okresowy, powiązany z subskrypcją.",
            "Zwiększa quota w Workload Control.",
        ),
        (
            "RESELLER_BATCH",
            "Pula kodów dla resellera.",
            "reseller_id, discount, liczba tokenów, tier allowlist, expiry, hardware bundle flag.",
            "Tokeny potomne jednorazowe; batch ma limit i reconciliation.",
            "Reseller wydaje token klientowi lub wiąże token ze skonfigurowanym sprzętem.",
        ),
        (
            "HARDWARE_BUNDLE",
            "Token sprzętowy dla Pixela/Puli AX sprzedanego przez resellera.",
            "device_batch_id, package profile, tier allowlist, reseller_id.",
            "Jednorazowy, wiąże claim ze sprzętem/paczką.",
            "Pozwala klientowi aktywować profil bez ujawniania sekretów resellerowi.",
        ),
        (
            "SERVICE_RECOVERY",
            "Kontrolowane odzyskanie albo support flow.",
            "scope, operator/recovery identity, expiry krótkie, support case.",
            "Krótko żyjący, wymaga ręcznej autoryzacji.",
            "Nie może omijać FIDO2/HSM ani panic policy.",
        ),
    ]

    token_lifecycle_rows = [
        ("quoted", "Użytkownik wybrał tier/dodatki. Nie istnieje token.", "quote_id, price, currency, tax estimate", "Quote expires."),
        ("payment_pending", "Order utworzony u PSP.", "order_id, provider, provider_session_id", "No token yet."),
        ("paid_unverified", "Webhook deklaruje płatność, ale system jeszcze nie wykonał API fetch.", "webhook_id, signature status", "No token mint before verification."),
        ("paid_verified", "Provider API potwierdził finalny paid/confirmed status.", "provider status, amount, currency, idempotency key", "Token mint allowed."),
        ("token_issued", "Token wygenerowany i pokazany/pobrany raz.", "token_id, token_hash, type, scope, expiry", "Plaintext token not stored."),
        ("claim_started", "Użytkownik wpisał token.", "claim_id, device/browser metadata, risk score", "Rate limit and anti-bruteforce."),
        ("claimed", "Token związany z recovery identity/operator identity.", "claim timestamp, public recovery id", "Token cannot be reused."),
        ("provisioning_pending", "Admin API dostał bootstrap event.", "plan_id, package manifest", "Async provisioning."),
        ("active", "Operator działa albo subskrypcja została zmieniona.", "operator_id, entitlement version", "Audit event."),
        ("expired/revoked", "Token nieaktywny.", "reason, actor, time", "Rejected on claim."),
    ]

    token_security_rows = [
        (
            "Format",
            "Token jest opaque secret: losowy materiał >= 256 bitów plus publiczny prefix i checksum dla UX. Entitlement nie jest kodowany jako prawda w samym tokenie.",
            "Atakujący nie może odgadnąć ani zmienić tieru przez edycję tokenu.",
        ),
        (
            "Storage",
            "Baza przechowuje tylko token_hash z pepper/HMAC po stronie serwera, publiczny token_id, typ, scope i status.",
            "Wyciek bazy nie daje tokenów do użycia.",
        ),
        (
            "Display",
            "Plaintext token pokazany tylko raz po opłaceniu albo w paczce resellera. Potem możliwe jest tylko revoke/regenerate.",
            "Ogranicza wycieki przez panel admina i support.",
        ),
        (
            "Claim",
            "Claim wymaga rate limit, proof-of-work/CAPTCHA gdzie legalne, risk scoring, device binding i jednoznacznego locka transakcyjnego.",
            "Chroni przed brute force, replay i race condition.",
        ),
        (
            "Webhook",
            "Każdy payment webhook wymaga weryfikacji podpisu, raw body, timestamp tolerance, idempotency i ponownego odczytu statusu z API providera.",
            "Chroni przed sfałszowanym paid event.",
        ),
        (
            "Ledger",
            "Token events, payment events, claim events i provisioning events są zapisywane w append-only ledger/WORM audit.",
            "Pozwala rozliczyć fraud, support i spory bez ujawniania sekretów.",
        ),
        (
            "Package binding",
            "Paczka Pixel/Puli AX ma package_manifest, hash, signature i powiązanie z token claim/operator identity.",
            "Chroni przed podmianą paczki startowej.",
        ),
        (
            "Recovery seed",
            "Recovery seed/operator wallet seed jest generowany i trzymany przez użytkownika. Portal przechowuje tylko pochodny publiczny recovery identifier.",
            "Brak klasycznego konta nie oznacza braku odzyskania, ale utrata seed może być nieodwracalna.",
        ),
    ]

    ui_rows = [
        (
            "Landing/pricing",
            "Pierwszy ekran pokazuje ofertę, porównanie tierów, ceny roczne, minimum 12 miesięcy, limity aplikacji, rotację, dedicated rules.",
            "CTA: Buy private, Buy as company, Reseller portal, Redeem token.",
            "Zero marketingowych obietnic anonimowości. Jasne residual risks i legal wording.",
        ),
        (
            "Tier configurator",
            "Karty Pilot/Standard/Pro/Phantom/Sovereign, add-ons, liczba środowisk, rotacje, Matrix, hardware bundle.",
            "Dynamiczny koszt: subskrypcja, dodatki, hardware, szacunkowy koszt utrzymania infrastruktury.",
            "Phantom/Sovereign mogą wymagać verification gate przed finalną aktywacją.",
        ),
        (
            "Payment choice",
            "Stripe/Mollie dla fiat, CoinGate dla crypto, manual invoice dla B2B.",
            "Każda metoda pokazuje prywatność, retencję, settlement time, ryzyka i dostępność.",
            "Nie generować tokenu przed verified paid.",
        ),
        (
            "Token delivery",
            "Po płatności użytkownik widzi token tylko raz, może pobrać zaszyfrowany receipt/package manifest i instrukcję claim.",
            "Opcja zapisania recovery seed i test zapisu seed przez użytkownika.",
            "Portal nie odzyska seed ani plaintext tokenu.",
        ),
        (
            "Redeem/claim token",
            "Pole wpisania tokenu, weryfikacja statusu, wybór trybu: mam sprzęt od resellera / pobierz paczki / aktywuj z Pixel.",
            "Po claim: provisioning status, paczka Pixel, paczka Puli AX, QR/deep link, status G1/G2/workload.",
            "Nie pokazywać publicznie 127.0.0.1 jako adresu produkcyjnego.",
        ),
        (
            "Reseller console",
            "Login resellera, batch tokenów, rabat, urządzenia, statusy, zwroty nieclaimed, eksport rozliczeń.",
            "Reseller może widzieć stan handlowy, ale nie może wejść w operator panel klienta.",
            "Każdy batch ma limit, expiry, audit i możliwość revoke.",
        ),
        (
            "B2B billing",
            "Dane firmy, VAT, faktury, purchase order, wielokrotne tokeny, role finansowe.",
            "Firma może zarządzać zakupami, ale nie treścią operatorów.",
            "Retencja księgowa zgodna z jurysdykcją i polityką prywatności.",
        ),
    ]

    privacy_rows = [
        (
            "B2C crypto",
            "Minimalne dane portalu, brak klasycznego konta, token/recovery seed.",
            "CoinGate i blockchain mogą przetwarzać lub ujawniać metadane płatności.",
            "Nie obiecujemy anonimowości; obiecujemy minimalizację danych w SYLION i jawne granice.",
        ),
        (
            "B2C fiat",
            "Portal może nie wymagać konta, ale PSP przetwarza dane płatności.",
            "Stripe/Mollie/bank mogą mieć dane karty, IP, kraj, fraud signals.",
            "SYLION nie przechowuje danych kart i używa hosted checkout.",
        ),
        (
            "B2B",
            "Dane firmy, faktury, VAT, kontakty finansowe.",
            "Retencja prawna/księgowa dłuższa niż B2C privacy-first.",
            "Oddzielić finance account od operator identity.",
        ),
        (
            "Reseller",
            "Reseller może znać klienta, sprzęt, numer zamówienia i token status.",
            "Reseller nie zna FIDO2/HSM/recovery seed/operator secrets.",
            "Umowa resellerska musi wymagać privacy handling i breach notification.",
        ),
        (
            "Analytics",
            "Tylko techniczne metryki, consent-aware analytics, bez tracking pixel do reklam.",
            "Ryzyko korelacji marketingowej i wycieku referrer.",
            "Preferować self-hosted analytics i krótką retencję.",
        ),
    ]

    data_model_rows = [
        ("orders", "order_id, channel, customer_type, tier, amount, currency, status", "Nie trzymać plaintext tokenu."),
        ("payment_attempts", "provider, provider_session_id, status, webhook_id, amount, currency", "Webhook raw payload tylko jeśli retention/legal pozwala; redakcja sekretów."),
        ("tokens", "token_id, token_hash, type, scope, tier, expiry, status, reseller_id", "Hash + pepper/HMAC; no plaintext."),
        ("token_claims", "claim_id, token_id, recovery_public_id, device posture, risk score, timestamp", "Bez seed, bez haseł."),
        ("entitlements", "operator_id, tier_version, quotas, rotation policy, addon flags", "Wersjonować policy."),
        ("packages", "package_id, operator_id/token_id, manifest_hash, signature, device profile", "Paczki podpisane; download short TTL."),
        ("resellers", "reseller_id, agreement status, discount, limits, KYB status", "No operator secrets."),
        ("audit_events", "actor, action, object, before/after safe diff, time, reason", "Append-only/WORM."),
    ]

    acceptance_rows = [
        ("Payment webhooks", "Forged webhook denied; replay denied; valid paid creates exactly one token.", "automated integration test"),
        ("Token brute force", "Random token guessing is rate-limited and never reveals whether prefix exists beyond generic error.", "negative security test"),
        ("Double claim", "Two concurrent claims result in one success and one deterministic deny.", "race test"),
        ("Reseller limit", "Reseller cannot exceed batch quota or create unsupported tier token.", "RBAC/quota test"),
        ("B2B invoice", "Invoice order can create token only after approved payment state.", "finance workflow test"),
        ("Crypto status", "Underpaid/expired/unconfirmed crypto order does not mint token.", "CoinGate sandbox/status test"),
        ("Package integrity", "Modified Pixel/Puli package is rejected by signature/hash check.", "tamper test"),
        ("Privacy", "No card data, seed, plaintext token or provider secret appears in logs/admin UI.", "log grep + UI inspection"),
        ("Portal isolation", "Portal VPS cannot reach operator stream/admin routes except narrow token/provisioning API.", "network negative test"),
    ]
    perspective_cards = [
        (
            f"Perspektywa portalu: {name}",
            [
                ("Cel biznesowy", goal),
                ("Funkcjonalność wymagana w UI", functions),
                ("Obsługa i odzyskanie", recovery),
                ("Granice prywatności i claimy", privacy),
                ("Test akceptacyjny", "Przejść cały flow w Playwright: wybór tieru, płatność sandbox albo symulowana, emisja tokenu, claim, paczka, bootstrap event i wpis WORM audit."),
            ],
        )
        for name, goal, functions, recovery, privacy in perspective_rows
    ]
    gateway_cards = [
        (
            f"Adapter płatności: {provider}",
            [
                ("Rola w platformie", role),
                ("Zakres metod", scope),
                ("Wymagane kontrole", controls),
                ("Uwagi prawno-prywatnościowe", notes),
                ("Failure modes", "Provider timeout, webhook duplicate, status mismatch, chargeback/refund request, manual dispute, underpayment albo expired checkout. Każdy przypadek musi mieć deterministyczny stan order i brak nieautoryzowanej emisji tokenu."),
                ("Dowody produkcyjne", "Log idempotency key, provider event id, verified status fetch, token ledger event, audit actor=system/provider-adapter."),
            ],
        )
        for provider, role, scope, controls, notes in gateway_rows
    ]
    token_cards = [
        (
            f"Token: {token_type}",
            [
                ("Cel", purpose),
                ("Scope i entitlement", scope),
                ("Reguła użycia", usage),
                ("Efekt systemowy", effect),
                ("Wymagany zapis audytowy", "token_id, token_type, status transition, actor, claim_id/order_id, entitlement_version, package_manifest_hash jeżeli dotyczy."),
                ("Negatywny test", "Token po użyciu, po expiry, z błędnym checksum, z błędnym scope albo przypisany do innego resellera musi zostać odrzucony bez ujawniania, który element był poprawny."),
            ],
        )
        for token_type, purpose, scope, usage, effect in token_type_rows
    ]
    ui_cards = [
        (
            f"Widok portalu: {view}",
            [
                ("Co użytkownik widzi", content),
                ("Co użytkownik może zrobić", actions),
                ("Wymóg projektowy", requirement),
                ("Helptipy i legal wording", "Każda decyzja wpływająca na prywatność, cenę, minimalny okres, brak refundu, crypto traceability, reseller handoff albo PHANTOM verification gate wymaga krótkiego helptipu i linku do pełnego opisu."),
                ("Test UI", "Desktop i mobile: brak overflow tekstu, czytelne porównanie tierów, dostępne CTA, poprawne error states, brak lokalnych adresów typu 127.0.0.1 w flow produkcyjnym."),
            ],
        )
        for view, content, actions, requirement in ui_rows
    ]

    portal_flow = base.svg(
        [
            {"id": "visitor", "label": "Visitor\nB2C / B2B / reseller", "x": 35, "y": 85, "w": 190, "h": 80},
            {"id": "portal", "label": "Public Portal\npricing + checkout", "x": 285, "y": 85, "w": 210, "h": 80, "fill": "#eef5ff"},
            {"id": "psp", "label": "Payment adapters\nStripe / CoinGate / Mollie", "x": 555, "y": 85, "w": 250, "h": 80, "fill": "#fff8e8", "stroke": "#e0a100"},
            {"id": "ledger", "label": "Payment + Token Ledger\nappend-only", "x": 335, "y": 260, "w": 245, "h": 90, "fill": "#eef8f4", "stroke": "#25a18e"},
            {"id": "claim", "label": "Token Claim\none-time + scoped", "x": 655, "y": 260, "w": 220, "h": 90},
            {"id": "admin", "label": "Admin API\nprovisioning event", "x": 145, "y": 260, "w": 160, "h": 90},
            {"id": "packages", "label": "Packages\nPixel + Puli AX", "x": 895, "y": 260, "w": 145, "h": 90},
        ],
        [
            ("visitor", "portal", "select tier"),
            ("portal", "psp", "checkout"),
            ("psp", "ledger", "verified paid webhook"),
            ("ledger", "claim", "issue token"),
            ("claim", "admin", "bootstrap event"),
            ("claim", "packages", "download"),
            ("admin", "packages", "manifest"),
        ],
        "X1. Portal zakupowy, płatność, token i bootstrap operatora",
    )

    source_rows = [
        ("Stripe", "Payment methods and webhooks", "https://docs.stripe.com/payments/payment-methods/overview ; https://docs.stripe.com/webhooks"),
        ("CoinGate", "Crypto payment API/callbacks/status", "https://developer.coingate.com/"),
        ("Mollie", "Payments API, hosted checkout, webhooks", "https://docs.mollie.com/"),
    ]

    return "\n".join([
        '<section class="appendix-portal">',
        '<h1>ZAŁĄCZNIK X - Portal zakupowy, płatności, tokeny i resellerzy</h1>',
        '<p>Ten aneks definiuje portal jako oddzielny publiczny moduł Zone 0. Portal sprzedaje tokeny i dodatki, obsługuje płatności oraz inicjuje bootstrap operatora, ale nie jest panelem administratora, panelem operatora ani brokerem streamingu. Portal ma być odseparowany sieciowo od G1/G2/workload stream i komunikować się z Admin API wyłącznie przez wąski, audytowany kanał provisioning/token.</p>',
        portal_flow,
        '<h2>X1. Perspektywy użytkownika i biznesu</h2>',
        _table(["Perspektywa", "Cel", "Funkcje portalu", "Odzyskanie/obsługa", "Granice prywatności"], perspective_rows, "wide"),
        '<h2>X2. Bramki płatności i model adapterów</h2>',
        _table(["Provider", "Rola", "Zakres", "Kontrole", "Uwagi"], gateway_rows, "wide"),
        '<h2>X3. Typy tokenów</h2>',
        _table(["Typ tokenu", "Cel", "Scope", "Użycie", "Efekt"], token_type_rows, "wide"),
        '<h2>X4. Lifecycle tokenu i płatności</h2>',
        _table(["Stan", "Opis", "Dowody/metadane", "Reguła"], token_lifecycle_rows, "wide"),
        '<h2>X5. Bezpieczeństwo tokenów</h2>',
        _table(["Kontrola", "Wymaganie", "Dlaczego"], token_security_rows, "wide"),
        '<h2>X6. UI/UX portalu</h2>',
        _table(["Widok", "Zawartość", "Akcje", "Wymóg"], ui_rows, "wide"),
        '<h2>X7. Prywatność, B2C, B2B i crypto</h2>',
        _table(["Ścieżka", "Co wie SYLION", "Co może wiedzieć strona trzecia", "Wording"], privacy_rows, "wide"),
        '<h2>X8. Minimalny model danych</h2>',
        _table(["Tabela/encja", "Pola", "Zakaz"], data_model_rows, "wide"),
        '<h2>X9. Kryteria odbioru portalu</h2>',
        _table(["Obszar", "Warunek przejścia", "Test"], acceptance_rows, "wide"),
        '<h2>X10. Źródła adapterów płatności</h2>',
        '<p>Źródła sprawdzone na potrzeby aneksu w dniu 2026-06-01. Warunki dostępności metod płatności i crypto zależą od onboardingu merchant, jurysdykcji, walut, risk review i aktualnych zasad providera.</p>',
        _table(["Provider", "Zakres źródła", "URL"], source_rows, "wide"),
        '<h2>X11. Szczegółowe perspektywy portalu</h2>',
        '<p>Poniższe karty rozwijają funkcjonalność portalu z punktu widzenia faktycznych użytkowników i zespołów operacyjnych. Każda perspektywa ma oddzielne testy, bo portal prywatny, B2B i resellerowski mają różne dane, ryzyka i ścieżki odzyskania.</p>',
        _detail_cards(perspective_cards, "portal-card"),
        '<h2>X12. Szczegółowe adaptery płatności</h2>',
        '<p>Adapter płatności nie może samodzielnie tworzyć operatora. Jego jedynym skutkiem jest zweryfikowany payment event, który po przejściu ledger lock pozwala wyemitować token. Token claim dopiero uruchamia provisioning.</p>',
        _detail_cards(gateway_cards, "portal-card"),
        '<h2>X13. Szczegółowe typy tokenów</h2>',
        '<p>Token jest kontraktem dostępu do określonej funkcji, nie kontem klienta. Każdy token ma scope, typ, expiry, status, źródło płatności albo źródło resellerskie i niezmienny audit trail.</p>',
        _detail_cards(token_cards, "portal-card"),
        '<h2>X14. Szczegółowe widoki i wymagania UI</h2>',
        '<p>Portal ma być publiczny, czytelny i kompletny. Najważniejszy ekran to nie landing page marketingowy, tylko konfigurator zakupu i redeem token. Użytkownik musi zrozumieć tier, cenę, minimalny okres, konsekwencje prywatności i dalszy bootstrap.</p>',
        _detail_cards(ui_cards, "portal-card"),
        '</section>',
    ])


def deep_operational_masterplan_appendix() -> str:
    modules = [
        ("Portal Commerce", "Publiczny zakup tokenów, konfiguracja tierów, wybór płatności, claim tokenu i wejście do bootstrapu operatora.", "Portal, Token Ledger, Payment Adapters, Admin API"),
        ("Payment Adapters", "Wspólna warstwa Stripe, CoinGate, Mollie i manual invoice, bez logiki tworzenia operatora wewnątrz adaptera.", "Portal, Token Ledger, Finance, Audit"),
        ("Token Ledger", "Jedno źródło prawdy dla tokenów, claimów, statusów, batchy resellerskich i powiązania z entitlement.", "Portal, Admin, Reseller Console, Provisioning"),
        ("Reseller Console", "Obsługa partnerów, batchy tokenów, rabatu, sprzętu, statusów unclaimed/claimed i rozliczeń.", "Portal, Token Ledger, Finance, Audit"),
        ("Admin Dashboard", "Główna konsola systemu: operatorzy, koszty, alerty, gates, status providerów i capacity.", "Admin API, Monitoring, Providers, Subscriptions"),
        ("Provider Registry", "Rejestr providerów VPS/bare metal, krajów, cen, capabilities, KVM, Firecracker, TDX, SEV-SNP i statusu API.", "Admin, Provisioning, Rotation, Cost Engine"),
        ("Subscription Policy", "Wersjonowane polityki tierów, limity środowisk, rotacje, dedykacja zasobów i minimalne okresy subskrypcji.", "Portal, Admin, Operator Panel, Provisioning"),
        ("Operator Registry", "Rejestr operatorów, statusów, tierów, kosztów, expiry, device binding, G1/G2/workload i ryzyka.", "Admin, Operator Panel, Monitoring, Audit"),
        ("Operator Panel Shell", "Panel pracy operatora: aplikacje, sesja, licznik TTL, Workload Control, settings, backup, panic, Matrix i rotacja.", "Operator API, G2, Workloads, Device Admission"),
        ("Pixel Package", "Paczka startowa dla GrapheneOS/Pixel: CA, profile, skróty, browser policy i ścieżka do operator panel.", "Portal Claim, Admin Provisioning, Device Inventory"),
        ("Puli AX Package", "Paczka routera: VPN do G1, kill switch, DNS leak prevention, telemetryka health i restart recovery.", "Router UI/API, G1, Device Inventory, Monitoring"),
        ("Device Admission", "Warstwa dopuszczająca terminal/router/FIDO2/HSM policy do sesji, bez zaufania do samego urządzenia.", "Pixel, Puli AX, G1, PKI, Operator Panel"),
        ("G1 Gateway", "Indywidualny gateway operatora, przyjmujący tylko dopuszczony ruch i nieprzechowujący danych aplikacyjnych.", "Puli AX, G2, PKI, Monitoring"),
        ("G2 Session Broker", "Broker sesji i streamingu do workloadu, z limitami połączeń, brakiem persistence i roadmapą blind broker.", "G1, Workload Orchestrator, Operator Panel"),
        ("Streaming/Input Bridge", "Warstwa obrazu i wejścia: dopasowanie do Pixela/laptopa, klawiatura, scroll, app switching i powrót do panelu.", "G2, Workload Apps, Pixel Browser, Laptop Browser"),
        ("Workload Orchestrator", "Planowanie, uruchamianie, recreate, destroy i status środowisk aplikacyjnych zgodnie z entitlement.", "Admin, Operator Panel, Firecracker Host Pool, App Catalog"),
        ("Firecracker Host Pool", "Bare-metal/KVM pool dla microVM, izolacja tenantów, host quarantine, capacity i evidence isolation.", "Provider Registry, Workload Orchestrator, Monitoring"),
        ("Application Catalog", "Globalny katalog autoryzowanych aplikacji i trybów: desktop, web, Android-native, limited/works/broken.", "Admin, Operator Panel, Workload Images"),
        ("Application Environments", "Instancje komunikatorów i narzędzi: Signal, Telegram, WhatsApp, Threema, Zangi, DuckDuckGo, LibreOffice, Exodus.", "Workload Orchestrator, Streaming, CDR, Monitoring"),
        ("CDR Pipeline", "Granica transferu plików: allow/deny/quarantine, hash, transform, unsupported formats i evidence chain.", "Operator Panel, Workloads, Admin SOC"),
        ("Matrix Server Addon", "Opcjonalny własny Matrix, polityka federacji, CDR, monitoring metadanych i add-on billing.", "Operator Panel, Workloads, Provider Registry"),
        ("Backup/Panic Policy", "Backup operatora, restore, inactivity wipe, panic levels i legal pre-approval dla działań destrukcyjnych.", "Operator Panel, Admin, Audit, Storage"),
        ("Jurisdiction Rotation", "Rotacja krajów/providerów według tieru, reuse sanitized pools i dedykacja wyższych tierów.", "Subscription Policy, Provider Registry, G1/G2, Workloads"),
        ("Monitoring/SIEM", "Blue-team metadane bez treści: health, route, auth, CDR, provider, cost, workload, anomaly score.", "All Components, Admin Dashboard, Incident Response"),
        ("Anomaly Engine", "Ocena P0-P3 z sygnałów routingu, kluczy, CDR, workload, providerów i admin actions.", "Monitoring, Admin, Audit, Incident Response"),
        ("Incident Response", "Containment, revoke, rebuild, rotate, quarantine, postmortem i ownerzy dla każdego alertu.", "Admin, Monitoring, G1/G2, Workloads, Audit"),
        ("Audit/WORM Evidence", "Niezmienny zapis tokenów, płatności, admin actions, provisioning, CDR, incidents i release gates.", "Portal, Admin, Operator, SRE, SOC"),
        ("PKI/HSM/FIDO2", "CA, certyfikaty, device certs, step-up, HSM/FIDO2 UI i późniejsze hardware acceptance tests.", "Admin, Device Admission, G1/G2, Operator Security"),
        ("Cost Engine", "Koszt operatora: G1, G2, workload, bare metal share, transfer, storage, add-ons i provider capacity.", "Provider Registry, Subscriptions, Admin Dashboard"),
        ("Human Regression Lab", "Testy jak człowiek przez Pixel/laptop: klik, wpisywanie, scroll, aplikacje, reset, streaming, przełączanie.", "Pixel ADB, Playwright, Operator Panel, Workloads"),
        ("Release Gates", "System decyzyjny works/partial/blocked oparty o E0-E8, testy negatywne, dowody i human gate.", "All Modules, Admin, Audit"),
    ]
    module_rows = [(name, purpose, deps) for name, purpose, deps in modules]
    module_map = base.svg(
        [
            {"id": "portal", "label": "Portal\npayments + tokens", "x": 35, "y": 85, "w": 170, "h": 75, "fill": "#eef5ff"},
            {"id": "admin", "label": "Admin\ncontrol plane", "x": 270, "y": 85, "w": 170, "h": 75, "fill": "#eef5ff"},
            {"id": "operator", "label": "Operator Panel\nsession + apps", "x": 505, "y": 85, "w": 190, "h": 75},
            {"id": "device", "label": "Pixel + Puli AX\nadmission", "x": 760, "y": 85, "w": 205, "h": 75},
            {"id": "g1", "label": "G1\nper operator", "x": 155, "y": 250, "w": 145, "h": 75},
            {"id": "g2", "label": "G2\nsession broker", "x": 370, "y": 250, "w": 160, "h": 75},
            {"id": "workload", "label": "Workloads\nFirecracker/apps", "x": 600, "y": 250, "w": 190, "h": 75},
            {"id": "audit", "label": "CDR/SIEM/Audit\nmetadata + evidence", "x": 280, "y": 400, "w": 245, "h": 80, "fill": "#fff8e8", "stroke": "#e0a100"},
            {"id": "providers", "label": "Providers/Cost\ncapacity + regions", "x": 615, "y": 400, "w": 220, "h": 80, "fill": "#eef8f4", "stroke": "#25a18e"},
        ],
        [
            ("portal", "admin", "bootstrap event"),
            ("admin", "operator", "entitlement"),
            ("operator", "device", "terminal flow"),
            ("device", "g1", "VPN"),
            ("g1", "g2", "tunnel"),
            ("g2", "workload", "stream"),
            ("workload", "audit", "CDR/events"),
            ("admin", "audit", "policy"),
            ("providers", "g1", "capacity"),
            ("providers", "workload", "bare metal"),
        ],
        "W1. Masterplan modułów i zależności wdrożeniowych",
    )
    release_rows = [
        ("E0", "Opis wymagań", "Sekcja Księgi, ADR, user story", "Nie potwierdza działania."),
        ("E1", "Static review", "Review architektury, threat model, legal/compliance wording", "Nie potwierdza runtime."),
        ("E2", "Unit/API contract", "Testy funkcji i schematów API", "Nie potwierdza integracji."),
        ("E3", "Integration", "Portal->token->admin, operator->workload, CDR flow", "Nie potwierdza UX człowieka."),
        ("E4", "Live metadata probe", "Rzeczywisty health path i reachability", "Nie potwierdza usability."),
        ("E5", "Human regression", "Pixel/laptop klikany jak człowiek", "Warunek dla aplikacji i streamingu."),
        ("E6", "Negative security", "Bypass denied, forged webhook denied, double claim denied", "Warunek dla granic bezpieczeństwa."),
        ("E7", "Repeatable regression", "Automatyczny, powtarzalny zestaw testów", "Warunek przed release."),
        ("E8", "Human gate", "Akceptacja CISO/legal/owner", "Nie zastępuje testów technicznych."),
    ]
    phase_rows = [
        ("Faza 1", "Portal, token ledger, payment adapters", "Signed webhook, one-time token, B2C/B2B/reseller flows."),
        ("Faza 2", "Admin core i provider registry", "Provider capabilities, subscriptions, operator table, audit."),
        ("Faza 3", "Operator panel i workload control", "App launcher, recreate, session TTL, backup/panic UI."),
        ("Faza 4", "Pixel/Puli/G1/G2 path", "Real route evidence, DNS leak prevention, no bypass."),
        ("Faza 5", "Workload isolation i aplikacje", "DuckDuckGo, LibreOffice, communicators, Exodus, app state labels."),
        ("Faza 6", "CDR, backup, Matrix, rotation", "File corpus, Matrix addon, rotation policy, cleanup proof."),
        ("Faza 7", "SOC, anomaly, IR", "P0-P3 alerts, incident workflows, WORM evidence."),
        ("Faza 8", "HSM/FIDO2/router final hardening", "Hardware acceptance, step-up, PHANTOM gates."),
    ]
    module_sections = []
    for idx, (name, purpose, deps) in enumerate(modules, start=1):
        module_sections.append(
            "\n".join([
                f'<section class="module-detail"><h2>W{idx}. {base.e(name)}</h2>',
                f'<p>{base.e(purpose)}</p>',
                _detail_card(
                    "Zakres funkcjonalny",
                    [
                        ("Cel modułu", purpose),
                        ("Użytkownik lub system", "Portal/Admin/Operator/SRE/SOC zależnie od modułu; odpowiedzialność musi być przypisana w backlogu i release gate."),
                        ("Główne zależności", deps),
                        ("Wyjście modułu", "Stan systemowy możliwy do sprawdzenia przez API, UI, audit event i test automatyczny. Moduł nie może opierać się na ręcznej deklaracji bez dowodu."),
                    ],
                ),
                _detail_card(
                    "Ekrany, API i dane",
                    [
                        ("Ekrany/UI", f"{name} musi mieć widok listy/statusu, widok szczegółu, stany loading/error/empty oraz jasne akcje operatora/admina, jeżeli moduł ma interakcję człowieka."),
                        ("API", "Każda mutacja ma endpoint idempotentny albo jawnie transakcyjny, walidację wejścia, RBAC, audit actor, request_id i correlation_id."),
                        ("Model danych", "Encje muszą mieć ownera tenant/operator, status lifecycle, created/updated timestamps, policy_version i bezpieczne pola do audytu bez sekretów."),
                        ("Sekrety", "Sekrety nie są wyświetlane po zapisie. UI pokazuje configured/not configured, fingerprint, serial albo publiczny identifier."),
                    ],
                ),
                _detail_card(
                    "Kontrole bezpieczeństwa",
                    [
                        ("RBAC i step-up", "Operacje krytyczne wymagają roli, step-up albo four-eyes. Działania PHANTOM wymagają human gate i oddzielnej akceptacji ryzyka."),
                        ("Granice danych", "Moduł nie może ujawniać treści wiadomości, seedów, haseł, kodów SMS, kluczy prywatnych ani zawartości prywatnych plików operatora."),
                        ("Audit", "Każda mutacja zapisuje WORM event: actor, action, target, safe diff, reason, result i correlation_id."),
                        ("Fail closed", "Przy braku policy, braku providera, braku certyfikatu, błędzie webhooka albo braku tunelu moduł ma blokować akcję zamiast tworzyć stan niejawny."),
                    ],
                    "gate-card",
                ),
                _detail_card(
                    "Awarie i scenariusze naprawy",
                    [
                        ("Typowe awarie", "Timeout, provider API failure, stale policy, quota exceeded, missing package, stream unreachable, race condition, failed audit write, out-of-capacity."),
                        ("Reakcja systemu", "Status przechodzi do failed/blocked/partial z czytelnym kodem błędu. Retry musi być idempotentny i widoczny w admin panelu."),
                        ("Rollback", "Rollback nie może usuwać evidence. Przy działaniach destrukcyjnych najpierw zamrożenie i zapis decyzji, potem dopiero wykonanie policy."),
                        ("Obsługa support", "Support widzi stan i metadane, ale nie widzi sekretów ani prywatnej treści operatora."),
                    ],
                ),
                _detail_card(
                    "Obserwowalność w panelu administratora",
                    [
                        ("Status główny", f"Moduł {name} musi raportować healthy/degraded/blocked, ostatnią zmianę stanu, ownera, wpływ na operatorów i link do ostatniego audytu."),
                        ("Metryki", "Minimalne metryki: success rate, latency p50/p95/p99, error rate, queue depth lub active sessions, koszt/capacity jeżeli dotyczy oraz liczba alertów P0-P3."),
                        ("Alerty", "Alert musi mieć severity, short reason, affected tenant/operator, affected component, first_seen, last_seen, runbook link, owner i możliwą akcję containment."),
                        ("Zakaz", "Panel nie może rozwiązywać problemu przez pokazanie sekretu, plaintext tokenu, seed, prywatnego pliku, treści wiadomości ani nagrania streamu."),
                    ],
                    "gate-card",
                ),
                _detail_card(
                    "Backlog implementacyjny",
                    [
                        ("P0", f"Zbudować minimalny kontrakt API/event dla {name}, RBAC, audit event, status lifecycle i test negatywny dla braku uprawnień."),
                        ("P1", "Dodać UI z empty/loading/error/success states, filtry, sortowanie, szczegóły rekordu i bezpieczne komunikaty błędów."),
                        ("P2", "Dodać raport kosztów albo capacity, jeżeli moduł ma wpływ na billing, providerów, workloady albo czas sesji."),
                        ("Dokumentacja", "Każdy endpoint, status, event i gate ma mieć krótki opis w Księdze albo ADR oraz przykład oczekiwanego audit event."),
                        ("Definition of done", "Moduł ma status works dopiero po przejściu testów kontraktowych, integracyjnych, negatywnych i human regression, jeżeli dotyczy terminala/operatora."),
                    ],
                ),
                _detail_card(
                    "Testy i dowody",
                    [
                        ("Test podstawowy", f"Playwright/API test potwierdza happy path modułu {name} oraz zapis audytu."),
                        ("Test negatywny", "Nieprawidłowy scope, brak entitlement, błędny podpis, próba cross-tenant albo brak wymaganej roli muszą zostać odrzucone."),
                        ("Test human", "Jeżeli moduł wpływa na Pixel/laptop/operator panel, wymagany jest test człowieka: klik, wpisywanie, scroll, przełączenie i powrót."),
                        ("Kryterium works", "Status works jest dozwolony dopiero po E5/E6 tam, gdzie moduł dotyka usability albo granicy bezpieczeństwa."),
                    ],
                ),
                _detail_card(
                    "Macierz testów modułu",
                    [
                        ("E2 API contract", "Walidacja schematów request/response/event, RBAC, status codes, idempotency i bezpiecznych błędów."),
                        ("E3 Integration", "Przepływ przez zależności modułu musi działać bez ręcznych zmian w bazie i bez mocków w ścieżce produkcyjnej."),
                        ("E4 Live probe", "Sonda metadanych ma potwierdzić reachability albo poprawny status blocked/degraded w realnym środowisku."),
                        ("E5 Human regression", "Jeżeli moduł wpływa na UI/terminal/aplikacje, człowiek albo ADB/Playwright musi wykonać realny workflow."),
                        ("E6 Security negative", "Cross-tenant, forged event, replay, stale policy, direct bypass i brak entitlement muszą kończyć się deny."),
                        ("E7 Regression", "Test musi być powtarzalny w CI/staging/live-safe i zapisywać artefakt do katalogu evidence."),
                    ],
                    "gate-card",
                ),
                '</section>',
            ])
        )
    return "\n".join([
        '<section class="appendix-masterplan">',
        '<h1>ZAŁĄCZNIK W - Rozszerzony masterplan modułów, wdrożeń i testów</h1>',
        '<p>Ten aneks rozbija SYLION 4.0 na moduły, które mogą być implementowane przez różne zespoły albo modele, ale muszą zostać złożone przez wspólne kontrakty: API, events, audit, ownership, entitlement i test evidence. To jest praktyczna mapa wdrożeniowa, nie skrót marketingowy.</p>',
        module_map,
        '<h2>W0. Rejestr modułów</h2>',
        _table(["Moduł", "Cel", "Zależności"], module_rows, "wide"),
        '<h2>W0.1 Fazy wdrożenia</h2>',
        _table(["Faza", "Zakres", "Warunek przejścia"], phase_rows, "wide"),
        '<h2>W0.2 Hierarchia dowodów release</h2>',
        _table(["Poziom", "Nazwa", "Dowód", "Uwagi"], release_rows, "wide"),
        "".join(module_sections),
        '</section>',
    ])


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    baseline_html, baseline_meta = base.extract_docx_html(
        base.BASELINE_DOCX,
        title="CZĘŚĆ B — Import pełnej Księgi SYLION v3.4 FIXED jako baseline traceability",
    )
    phantom_source_doc = base.Document(str(base.PHANTOM_DOCX))
    phantom_headings = []
    for p in phantom_source_doc.paragraphs:
        text = p.text.strip()
        if not text:
            continue
        style = p.style.name if p.style else ""
        if "Heading" in style:
            phantom_headings.append((style, text))
    phantom_index_rows = "".join(f"<tr><td>{base.e(style)}</td><td>{base.e(text)}</td></tr>" for style, text in phantom_headings)
    phantom_index = f"""
    <section>
      <h1>CZĘŚĆ C — Indeks źródłowy PHANTOM v3.0</h1>
      <p>Indeks pokazuje pełną strukturę źródłowego dokumentu PHANTOM v3.0. Warstwa internal 4.0 rozdziela elementy produktowe, governance, lab-only i zewnętrzne restricted SOP.</p>
      <table><tr><th>Styl</th><th>Nagłówek źródłowy</th></tr>{phantom_index_rows}</table>
    </section>
    """
    body = "\n".join([
        internal_addendum(),
        static_table_of_contents(),
        security_atlas(),
        base.front_matter(),
        base.diagrams_html(),
        base.generated_reference_sections(),
        baseline_html,
        base.phantom_safe_profile(),
        phantom_index,
        portal_commerce_token_appendix(),
        final_comparison_and_admin_deep_dive(),
        tiered_threat_analysis_appendix(),
        deep_operational_masterplan_appendix(),
    ])
    html_doc = f"""<!doctype html>
    <html lang="pl">
    <head>
      <meta charset="utf-8">
      <title>STRICTLY INTERNAL - Księga 4.0 SYLION PHANTOM</title>
      <style>{base.css()} {internal_extra_css()} .internal-cover h1 {{ color:#7a1010; }} .internal-cover {{ border-top: 8px solid #7a1010; }}</style>
    </head>
    <body>{body}</body>
    </html>"""
    HTML_OUT.write_text(html_doc, encoding="utf-8")
    META_OUT.write_text(json.dumps({
        "html": str(HTML_OUT),
        "baseline": baseline_meta,
        "phantom_headings": len(phantom_headings),
        "generated": date.today().isoformat(),
        "classification": "STRICTLY INTERNAL",
        "included": "Legal production runbooks and internal technical procedures.",
        "excluded": "Operational instructions for telecom identity manipulation, lawful-control bypass, or evasion.",
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"html": str(HTML_OUT), "meta": str(META_OUT), "baseline": baseline_meta, "phantom_headings": len(phantom_headings)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
