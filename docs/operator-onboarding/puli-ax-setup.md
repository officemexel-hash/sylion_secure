# Puli AX (GL-XE3000) — runbook setup

> Manualny runbook do uruchomienia po dostarczeniu GL.iNet GL-XE3000 Puli AX. Per ADR-router-phantom-001 §6 conditions C1-C11.

**Wymagania wstępne:**
- Fizyczny Puli AX (GL.iNet GL-XE3000) — dostarczony
- Laptop z SSH client
- USB-C kabel (data-capable, oryginalny)
- Operator IPsec certificate + private key + G1 CA cert (provisioned przez admin API)
- G1 endpoint FQDN/IP (z `terraform output demo_g1_ipv4`)

## Etap 0: Unboxing + spec verification

Przed cokolwiek konfigurujemy, **uzupełnij `?` z ADR-001 §4 gate table** rzeczywistymi danymi z karty katalogowej + etykiety na urządzeniu:

```
[ ] RAM: ____ MB (target ≥256 MB, recommended ≥512 MB)
[ ] Flash: ____ MB NAND (target ≥256 MB)
[ ] CPU: ____ (np. Qualcomm IPQ5018)
[ ] WiFi: ____ (target AX/WiFi6)
[ ] Modem: ____ (target Quectel RM520N-GL 5G)
[ ] SIM slots: ____ (target 2× nano-SIM removable)
[ ] Battery: ____ mAh (target ≥10000)
[ ] FW out of box: ____ (GL OS x.x.x)
[ ] Serial number: ____
[ ] FCC/CE certs visible on label: ____
```

Wpisz to do `infrastructure/puli-ax/inventory-<serial>.txt` (gitignored).

## Etap 1: First boot + LAN connection

1. Włóż 2× nano-SIM (jeśli już masz prepaid). Lub pomiń i zrób później.
2. Podłącz USB-C power (lub naładuj baterię). 
3. Wciśnij power button — czekaj ~60s na pełen boot
4. **Podłącz laptop** kablem Ethernet do LAN portu (NIE WAN) lub przez WiFi do SSID `GL-XE3000-xxx` (hasło na naklejce pod urządzeniem)
5. Otwórz przeglądarkę: `http://192.168.8.1`
6. Stwórz initial admin password (8+ chars, unique)
7. Zaakceptuj GL.iNet ToS

## Etap 2: SSH access + backup current state

1. W GL.iNet panelu: **SYSTEM → Advanced Settings → Embedded Web Server** włącz LuCI
2. Lub: **SYSTEM → SSH Access** włącz SSH na LAN port 22
3. Z laptopa:

```bash
# Set SSH key auth (NIE password)
ssh-keygen -t ed25519 -f ~/.ssh/sylion-puli-ax-key -C "sylion-puli-ax-admin"

# Upload public key
ssh root@192.168.8.1
# password z step 1.6 above
mkdir -p /etc/dropbear
echo "ssh-ed25519 AAAA... sylion-puli-ax-admin" > /etc/dropbear/authorized_keys
chmod 600 /etc/dropbear/authorized_keys
exit

# Test
ssh -i ~/.ssh/sylion-puli-ax-key root@192.168.8.1
# powinno wejść bez hasła
```

4. Backup factory state:

```bash
ssh root@192.168.8.1 "tar czf - /etc/config /etc/dropbear /etc/firewall.user 2>/dev/null" > puli-ax-factory-backup-$(date +%Y%m%d).tar.gz
```

Zachowaj ten plik **poza** repo (gitignored).

## Etap 3: Wgranie SYLION konfiguracji

```bash
# Z root projektu SYLION:
cd "C:\Users\razor\OneDrive\Desktop\sylion secure"

# Set G1 endpoint (z Terraform output)
export G1_ENDPOINT="g1-lab.sylion.internal"  # lub konkretne IP

# Copy bundle na router
scp -r infrastructure/puli-ax root@192.168.8.1:/tmp/

# Dry-run najpierw
ssh root@192.168.8.1 "sh /tmp/puli-ax/setup.sh --backend=glos --g1-endpoint=$G1_ENDPOINT"

# Review output — czy widać wszystkie M-gates OK?

# Apply (real changes)
ssh root@192.168.8.1 "sh /tmp/puli-ax/setup.sh --apply --backend=glos --g1-endpoint=$G1_ENDPOINT"
```

## Etap 4: Provisioning certs

SYLION admin panel (z Step 3.30 RouterReadinessService) wygeneruje:
- `operator.crt` (operator client cert)
- `operator.key` (private key)
- `g1-ca.crt` (G1 CA cert)

Pobierz przez admin API:

```bash
# z laptopa
curl -fsS -H "Authorization: Bearer $SYLION_ADMIN_TOKEN" \
  "${SYLION_ADMIN_API_URL}/operators/${OPERATOR_ID}/router-package?download=cert-bundle" \
  -o cert-bundle.tar.gz

tar tzf cert-bundle.tar.gz   # verify

# Upload na router
scp cert-bundle.tar.gz root@192.168.8.1:/tmp/
ssh root@192.168.8.1 <<'REMOTE'
mkdir -p /etc/sylion
cd /etc/sylion
tar xzf /tmp/cert-bundle.tar.gz
chmod 600 operator.key
chmod 644 operator.crt g1-ca.crt
rm /tmp/cert-bundle.tar.gz
REMOTE
```

## Etap 5: Reboot + verify

```bash
ssh root@192.168.8.1 "reboot"
# Czekaj ~60s

# Verify boot
ssh root@192.168.8.1 "cat /var/log/sylion-readiness.log 2>/dev/null && systemctl is-active strongswan"

# Verify nftables loaded BEFORE strongSwan (warunek C4)
ssh root@192.168.8.1 "nft list ruleset | head -20"
```

## Etap 6: Test suite T01-T10

```bash
ssh root@192.168.8.1 "cd /tmp/puli-ax/test-suite && sh run-all.sh"
```

Oczekiwany output:
```
T01 PASS — Kill switch active BEFORE IPsec tunnel
T02 PASS — LAN→WAN blocked without tunnel
T03 PASS — DNS leak prevention
T04 PASS — IKEv2 cert auth + approved proposals
T05 PASS — Rekey + DPD recovery config
T06 PASS — Firmware signature / provenance
T07 PASS — Config drift detection (baseline recorded)
T08 SKIP — AES-256-GCM throughput (manual followup)
T09 SKIP — CPU/RAM pressure (manual followup)
T10 PASS — Power-loss recovery (boot order)

╭──────────────────────────────────────────────╮
│ PASS:  8                                       │
│ FAIL:  0                                       │
│ SKIP:  2                                       │
╰──────────────────────────────────────────────╯
```

Skopiuj `/tmp/sylion-test-summary-*.txt` na laptop jako evidence:
```bash
scp root@192.168.8.1:/tmp/sylion-test-summary-*.txt docs/admin-panel-v2/test-artifacts/puli-ax-T01-T10-$(date +%Y%m%d)/
```

## Etap 7: Tunnel up + verify connectivity

```bash
ssh root@192.168.8.1 "ipsec restart && sleep 5 && ipsec statusall"
# Powinno pokazać "INSTALLED, TUNNEL" dla sylion-g1 connection
```

Z laptopa podłączonego do LAN Puli AX:

```bash
# Should reach internal G1 services tylko przez tunnel
curl -fsS http://10.42.1.10:8080/health
# {"status":"ok","service":"admin-api"}

# DNS should NOT leak — sprawdź że poprawne odpowiedzi tylko przez G1
nslookup admin-api.sylion.internal
# powinno zwrócić 10.42.1.10 lub podobne wewnętrzne IP
```

## Etap 8: Enroll device w SYLION admin panel

Po pełnym T01-T10 pass + tunnel up:

1. Admin panel `/admin` → **Devices → Register**
2. Type: `puli_ax_router`
3. Serial: ze step 0
4. Model: `GL.iNet GL-XE3000 Puli AX`
5. Firmware: ze step 0 + setup output
6. Status: `qualified` (po T01-T10 pass)
7. Upload test summary: `/tmp/sylion-test-summary-*.txt`

## Troubleshooting

| Problem | Diagnoza | Fix |
|---|---|---|
| SSH dropbear nie startuje | Wrong key permissions | `chmod 600 /etc/dropbear/authorized_keys` |
| ipsec statusall = brak SA | Wrong G1 endpoint lub cert mismatch | Verify `/etc/ipsec.conf` G1 endpoint matches Terraform output |
| Tunnel up ale brak ruchu LAN→G1 | Forward chain DROP | Verify nftables po tunnel up nie blokuje xfrm |
| DNS query failuje pre-tunnel | Expected (kill switch) | Real test: po tunnel up DNS powinien iść do G1 |
| `nft list ruleset` pusty po reboot | rc.local nie wczytane | `cat /etc/rc.local` → upewnij się że jest `nft -f /etc/sylion/killswitch-pre-vpn.nft` |
| Router nie boot'uje po setup | brick risk | Hard reset (10s power button), reflash via web installer |

## Backout / disaster recovery

Jeśli setup spowodował niedostępność routera:

1. Hard reset (10s power button) — przywraca factory firmware
2. Odzyskaj backup z Etap 2: `cd / && tar xzf /tmp/puli-ax-factory-backup-*.tar.gz`
3. Reboot
4. Skontaktuj się z Hardware Lead — analiza co poszło źle

## Po sukcesie

```
[ ] T01-T10 all PASS lub explicit SKIP
[ ] Evidence w docs/admin-panel-v2/test-artifacts/puli-ax-T01-T10-*/
[ ] Device enrolled w SYLION admin panel jako qualified
[ ] First operator może otworzyć /operator portal przez tunnel
[ ] Update ADR-router-phantom-001 status: PROPOSED → ACCEPTED (po Architect+CISO sign-off)
[ ] Update ADR-001 §"Domniemane spec" — zamień `?` na actual values
[ ] Commit T01-T10 evidence files do repo
```

## Refs

- `infrastructure/puli-ax/setup.sh`
- `infrastructure/puli-ax/config/*`
- `infrastructure/puli-ax/test-suite/run-all.sh`
- `adr/ADR-router-phantom-001.md` REVISED §6, §9
- `adr/ADR-router-baseline-002.md` §4 BoM
- PHANTOM v3.0 §16 (DOPUSZCZALNE routery)
- Step 3.30 freeze (RouterReadinessService)
