# SYLION Admin Panel V1 - Freeze Zakresu

Status: frozen planning baseline V1  
Data: 2026-05-20  
Zakres: panel administratora, provisioning operatorów, workloady, CDR, monitoring, subskrypcje, jurysdykcje

## Cel

Panel administratora SYLION ma być centralną warstwą kontroli nad cyklem życia operatora:

```text
tenant -> operator -> plan provisioningowy -> 3 VPS -> urządzenia -> enrollment -> workloady -> monitoring -> rotacja -> incydenty
```

Panel nie jest tylko UI. Jest narzędziem operacyjnym spinającym tożsamość, uprawnienia, providerów, provisioning, PKI, obrazy, urządzenia, workloady, CDR, monitoring, audyt i subskrypcje.

## Decyzje Zamrożone

1. Każdy operator ma własne 3 VPS:
   - G1 VPS
   - G2 VPS
   - Workload VPS

2. Brak współdzielenia G1/G2/Workload VPS między operatorami.

3. Router docelowy produktu:
   - GL.iNet GL-XE3000 Puli AX

4. Puli AX jest decyzją produktową, ale nadal wymaga kwalifikacji bezpieczeństwa przed produkcyjnym baseline:
   - hardened firmware path
   - strongSwan IKEv2
   - nftables kill switch
   - DNS leak prevention
   - firmware provenance/signing
   - config drift reporting
   - failure tests

5. Jurisdictional rotation jest funkcją produktu.

6. Jurisdictional rotation opisujemy jako legalną kontrolę regionów/providerów i ekspozycji infrastrukturalnej, nie jako stealth ani omijanie prawa.

7. Operator może tworzyć wiele środowisk aplikacyjnych z katalogu aplikacji autoryzowanych.

8. Tylko Global Super Admin może dodawać, zatwierdzać, blokować i zmieniać aplikacje w Authorized App Catalog.

9. Każde środowisko aplikacyjne działa jako osobna Firecracker microVM.

10. Limity workloadów są zależne od subskrypcji.

11. Liczymy środowiska według aplikacji/microVM, z limitem sumarycznym per tier:
    - STANDARD: 3
    - PRO: 10
    - SOVEREIGN: 30

12. Matrix custom server jest opcjonalnym, dodatkowo płatnym add-onem.

13. Matrix może działać jako:
    - shared Matrix
    - dedicated tenant Matrix
    - dedicated operator Matrix

14. CDR jest obowiązkowy dla file ingress/egress.

15. Zasada CDR:

```text
No file ingress/egress without CDR decision.
```

16. Operator przy pierwszym uruchomieniu konfiguruje:
    - FIDO2
    - hasło
    - czas trwania sesji
    - częstotliwość re-auth
    - ustawienia bezpieczeństwa

17. Domyślna podpowiedź długości sesji Thin Client:

```text
12h
```

18. Panel nie może znać prywatnych sekretów operatora:
    - seed phrase
    - hasła walleta
    - hasła komunikatorów
    - prywatne recovery secrets

19. Aplikacje typu wallet, np. Exodus, są uruchamiane na odpowiedzialność operatora.

20. Audyt działa na bieżąco. Retencja audytu pozostaje parametrem tieru/polityki.

21. Operacje destrukcyjne i wysokiego ryzyka wymagają four-eyes approval.

## Tiery V1

| Funkcja | STANDARD | PRO | SOVEREIGN |
|---|---:|---:|---:|
| VPS per operator | 3 | 3 | 3 |
| Router | Puli AX | Puli AX | Puli AX |
| Workload environments | 3 | 10 | 30 |
| Matrix custom server | add-on | add-on | add-on |
| Jurisdiction rotation | limited/manual | scheduled | full policy |
| Rotacja G1/G2/Workload | limited | scheduled rebuild | full/aggressive rebuild |
| Provider rotation | limited | multi-provider | multi-provider policy |
| Region count | 1-2 | 3-5 | custom |
| Thin Client session | operator config | operator config | operator config |
| Domyślna podpowiedź sesji | 12h | 12h | 12h |
| CDR | mandatory | mandatory | mandatory |
| Live audit | yes | yes | yes |
| Custom apps by operator | no | no | no |
| Apps by Global Super Admin | yes | yes | yes |
| Wallet apps | operator responsibility | operator responsibility | operator responsibility |

## Zakładki Panelu

```text
1. Dashboard
2. Tenants
3. Operators
4. Subscriptions
5. Authorized Apps
6. Operator Workloads
7. Matrix Servers
8. Provisioning
9. Devices
10. Infrastructure
11. Jurisdiction Policies
12. CDR
13. Monitoring & Anomalies
14. Audit Log
15. Incidents
16. Access & Security
17. System Settings
```

## Role V1

```text
Global Super Admin
Security Admin
Provisioning Admin
Tenant Admin
Billing Admin
Auditor
Incident Commander
Support ReadOnly
```

## Akcje Four-Eyes

```text
operator.revoke
device.wipe
vps.destroy
jurisdiction.full_rotate
cert.root_rotate
cert.intermediate_rotate
audit.export_sensitive
provider.secret.rotate
```

## Wymagania Audytu

Audit event powinien zawierać:

```text
actor_id
action
resource_type
resource_id
tenant_id
operator_id, jeśli dotyczy
timestamp
correlation_id
idempotency_key, jeśli dotyczy
previous_value
new_value
policy_decision
approval_id, jeśli dotyczy
result
```

## Human Gate

HUMAN GATE REQUIRED pozostaje wymagany dla:

```text
produkcyjnej kwalifikacji Puli AX
finalnych polityk jurisdictional rotation per rynek
BYO-HSM/KMS i lawful-access exposure
certyfikacyjnych claimów produktu
PHANTOM-adjacent lub legal-review content
zmian osłabiających baseline bezpieczeństwa
```
