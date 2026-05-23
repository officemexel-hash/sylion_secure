# Puli AX (GL-XE3000) Setup Bundle

> OpenWrt UCI bundle dla GL.iNet GL-XE3000 "Puli AX" — per [`adr/ADR-router-phantom-001.md`](../../adr/ADR-router-phantom-001.md) REVISED.

Realizuje warunki C1-C11 z ADR-001 §6 + test suite T01-T10 z ADR-001 §9.

## Pliki

```
puli-ax/
├── README.md                 # ten plik
├── setup.sh                  # main installer (idempotent, dry-run by default)
├── flash-firmware.sh         # OpenWrt 23.05+ flashing (TBD jeśli custom build)
├── config/                   # UCI config snippets
│   ├── network               # WAN/LAN, no IPv6 leak
│   ├── firewall              # nftables default-drop kill switch
│   ├── ipsec                 # strongSwan IKEv2 baseline
│   ├── dhcp                  # DHCP + DNS tunneled-only
│   └── system                # hostname, timezone, log rotation
└── test-suite/               # T01-T10 verification (run on router)
    ├── t01-killswitch-active-pre-vpn.sh
    ├── t02-lan-to-wan-blocked-no-tunnel.sh
    ├── t03-dns-leak-prevention.sh
    ├── t04-ikev2-cert-auth.sh
    ├── t05-rekey-dpd-recovery.sh
    ├── t06-firmware-signature.sh
    ├── t07-config-drift.sh
    ├── t08-throughput-aes-gcm.sh
    ├── t09-cpu-ram-pressure.sh
    └── t10-power-loss-recovery.sh
```

## Pre-requisites

| Wymaganie | Status |
|---|---|
| Hardware: GL.iNet GL-XE3000 Puli AX | per BoM T1 (ADR-router-baseline-002) |
| Stock firmware | GL OS 4.x (OpenWrt 21.02 base) — może być, ale recommended own build 23.05+ |
| Physical access | TAK — ten setup nie jest remote |
| SSH-capable laptop | TAK — z scp/ssh |
| USB-C cable | data-capable (oryginalny) |
| Spec verification | NEEDS EVIDENCE per ADR-001 §4 — fill in po unboxing |

## Two paths

### Path A: GL OS stock firmware (faster, CVE-lag accepted)

Per ADR-001 warunek C2 alternative: "świadoma akceptacja GL OS CVE-lag z risk register entry".

```bash
# Na laptopie:
scp setup.sh root@192.168.8.1:/tmp/
ssh root@192.168.8.1 "sh /tmp/setup.sh --backend=glos --dry-run"
# Review output
ssh root@192.168.8.1 "sh /tmp/setup.sh --backend=glos --apply"
```

### Path B: Custom OpenWrt 23.05+ build (more work, mainline)

Per ADR-001 warunek C2 primary + warunek C3 (custom firmware build & signing pipeline ADR-004 TBD).

1. Build OpenWrt 23.05+ for IPQ5018 target (GL-XE3000)
2. Sign z own GPG/Sigstore key
3. Flash via U-Boot lub web installer
4. Run `setup.sh --backend=openwrt --apply`

## Default mode = dry-run

`setup.sh` defaults to **dry-run** (per ADR-001 invariant). Wymaga `--apply` żeby cokolwiek zrobiło.

```bash
sh setup.sh                    # dry-run, prints what would happen
sh setup.sh --apply            # actually applies
sh setup.sh --apply --backend=glos     # GL OS variant
sh setup.sh --apply --backend=openwrt  # mainline variant (po custom flash)
```

## Test suite

Po setup:

```bash
ssh root@192.168.8.1 "cd /tmp && sh t01-killswitch-active-pre-vpn.sh"
# ... wszystkie T01-T10 po kolei
# lub:
ssh root@192.168.8.1 "for t in /tmp/t*.sh; do sh \"\$t\"; done"
```

Każdy test wypisuje `PASS` lub `FAIL`. Pełny pass T01-T10 = readiness do operator enrollment.

## Co setup robi

Per ADR-001 §"Gate Table":

1. **M3 nftables default-deny kill switch** — `config/firewall` + boot-order: nftables → strongSwan (per warunek C4)
2. **M2 strongSwan IPsec IKEv2** — cert-based mutual auth, AES-256-GCM + SHA-384 + ECDSA P-384
3. **M7 separate WAN/LAN** — standard OpenWrt, dodatkowo zero VLAN bridge między WAN i LAN
4. **R3 HW AES** — verify że Qualcomm crypto engine włączony
5. **R6 read-only rootfs** (opcjonalnie) — overlay z luks (custom build only)
6. **DNS tunneled-only** — `config/dhcp` ustawia DNS na G1 endpoint, blokuje DNS poza tunel
7. **System hygiene** — wyłącz WAN admin, SSH key-only, minimal package list, log rotation

## Co setup NIE robi

- **IMEI/IMSI override** — to PHANTOM `[A]` profile per ADR-002, **Legal-gated**, **out of scope** tego setup
- **Production deployment** — to lab setup; production wymaga custom firmware build (ADR-004) + signing pipeline + Verified Boot
- **eSIM Management automation** — manual via panel/lpac per PHANTOM §16
- **Tamper-evident chassis** — hardware feature, nie konfiguracja
- **Production HSM integration** — Phase B (ADR-vault-adapter-001)

## Backout

Jeśli setup popsuje router:

1. Hard reset Puli AX (przytrzymaj reset button 10s na włączonym)
2. Re-flash stock firmware via web installer (GL.iNet recovery image)
3. Patrz `docs/operator-onboarding/puli-ax-recovery.md` (TBD)

## Po setup co dalej

```
1. Run T01-T10 test suite — wszystkie PASS
2. Capture evidence — copy /tmp/*.log do `docs/admin-panel-v2/test-artifacts/puli-ax-T01-T10-<date>/`
3. Run setup hash check — git commit `infrastructure/puli-ax/applied-config-<date>.txt`
4. Enroll w SYLION admin panel — device record per Step 3.30 RouterReadinessService
5. Operator first connection — patrz `docs/operator-onboarding/operator-first-login.md` (TBD)
```

## Refs

- [`adr/ADR-router-phantom-001.md`](../../adr/ADR-router-phantom-001.md) §6 conditions, §9 test plan
- [`adr/ADR-router-baseline-002.md`](../../adr/ADR-router-baseline-002.md) §4 BoM T1
- [`shared/references/hardware-gates.md`](../../shared/references/hardware-gates.md) Access Router Gates
- [`docs/operator-onboarding/pixel-wipe-and-grapheneos.md`](../../docs/operator-onboarding/pixel-wipe-and-grapheneos.md) — Pixel side
- [GL.iNet GL-XE3000 official](https://www.gl-inet.com/products/gl-xe3000/)
- [OpenWrt 23.05 release notes](https://openwrt.org/releases/23.05/start)
- [strongSwan IKEv2 config](https://docs.strongswan.org/docs/5.9/config/quickstart.html)
