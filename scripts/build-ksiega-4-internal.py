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
        base.front_matter(),
        base.diagrams_html(),
        base.generated_reference_sections(),
        baseline_html,
        base.phantom_safe_profile(),
        phantom_index,
    ])
    html_doc = f"""<!doctype html>
    <html lang="pl">
    <head>
      <meta charset="utf-8">
      <title>STRICTLY INTERNAL - Księga 4.0 SYLION PHANTOM</title>
      <style>{base.css()} .internal-cover h1 {{ color:#7a1010; }} .internal-cover {{ border-top: 8px solid #7a1010; }}</style>
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
