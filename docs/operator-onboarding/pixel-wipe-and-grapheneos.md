# Pixel — wipe-to-zero + reinstalacja GrapheneOS

> Runbook do **manualnego** wykonania na fizycznym urządzeniu Pixel. Operator wykonuje, agent nie kontroluje urządzenia headless.

**Cel:** wyczyścić Pixela do stanu factory + zainstalować świeżą kopię GrapheneOS. Brak persystencji z poprzednich prób.

**Czas:** ~30-45 minut (download GrapheneOS factory image ~2GB + flash + first-boot).

**Destrukcyjność:** **TOTAL DATA LOSS.** Wszystkie dane na urządzeniu zostaną usunięte. Zakładamy że nic na urządzeniu nie wymaga zachowania (per założenie operator dev/lab device).

---

## 0. Wymagania wstępne

- Pixel: model z grupy [GrapheneOS supported devices](https://grapheneos.org/install/web#supported-devices) (Pixel 6/7/8/9/10 series, recommended 8a+ dla long-term support)
- USB-C kabel **data-capable** (nie tylko power; np. oryginalny z pudełka Pixela)
- Komputer z **Chrome lub Edge** (Chromium-based, WebUSB API support)
- Stabilny internet (~2 GB download)
- Bateria Pixela ≥30% (lub podłączona do power przez wipe)

---

## 1. Pre-flight check (Pixel)

Przed wipe potwierdź na urządzeniu:

```text
Settings → About phone → Build number
  → tap 7× aby odblokować Developer Options
Settings → System → Developer options
  → enable "USB debugging"
  → enable "OEM unlocking"
Settings → About phone → Model & hardware
  → spisz model code (np. "shiba" dla Pixel 8, "husky" dla Pixel 8 Pro)
```

**Jeśli OEM unlocking jest grayed-out** = urządzenie z carrier lockiem lub bootloader już permanentnie zablokowany → urządzenie **nieprzydatne** dla SYLION operator deployment. Procurement nowego unit.

---

## 2. Ścieżka A — Web installer (RECOMMENDED)

Najprostsze, najmniej ryzyka błędu, **nie wymaga ADB/fastboot lokalnie**.

### 2.1 Otwórz web installer

W Chrome/Edge na komputerze:

```
https://grapheneos.org/install/web
```

Wybierz model swojego Pixela ze ścrolla.

### 2.2 Boot do bootloader mode

1. Wyłącz Pixela całkowicie (Power + Vol Down → "Power off")
2. Trzymaj **Vol Down + Power** aż pojawi się "Fastboot Mode" (białe litery na czarnym tle)
3. Podłącz Pixel do komputera kablem USB-C
4. W Chrome kliknij **"Connect"** → wybierz urządzenie z listy

### 2.3 Unlock bootloader (jeśli zablokowany)

W web installer: **"Unlock bootloader"** → klik.

Na Pixelu Vol Down do wyboru **"Unlock the bootloader"** → Power button confirm.

⚠️ **Pixel skasuje wszystkie dane** w tym momencie (factory wipe wymuszony przez OEM).

Pixel zrebootuje do bootloader mode.

### 2.4 Flash GrapheneOS

W web installer: **"Download release"** → czeka aż się ściągnie.
Potem **"Flash release"** → trwa 5-15 min.

Po flashu: **"Lock bootloader"** → klik. Na Pixelu Vol Down → **"Lock the bootloader"** → Power button.

⚠️ **Pixel skasuje wszystkie dane drugi raz** (lock bootloader requires wipe per Android security model — to NORMAL).

### 2.5 First boot

Po lock bootloader: pull cable, Power button → Pixel zboot do GrapheneOS welcome screen.

GrapheneOS jest teraz na urządzeniu. **Bootloader jest zablokowany** (Verified Boot enforced).

---

## 3. Ścieżka B — CLI fastboot (advanced, jeśli web installer fails)

Wymaga zainstalowanego `fastboot` na komputerze.

### 3.1 Install platform-tools (Windows)

```powershell
# Option 1: winget
winget install --id Google.PlatformTools

# Option 2: manual download
# https://developer.android.com/tools/releases/platform-tools
# unzip + dodaj do PATH
```

### 3.2 Boot Pixela do bootloader (jak w §2.2)

### 3.3 Verify connection

```powershell
fastboot devices
# expected: <serial>    fastboot
```

### 3.4 Download factory image

```powershell
# Replace <DEVICE> with model code (e.g., "shiba" for Pixel 8)
# Replace <DATE> with current release tag
cd $env:TEMP
Invoke-WebRequest -Uri "https://releases.grapheneos.org/<DEVICE>-factory-<DATE>.zip" -OutFile "graphene.zip"
Invoke-WebRequest -Uri "https://releases.grapheneos.org/<DEVICE>-factory-<DATE>.zip.sig" -OutFile "graphene.zip.sig"
# Optionally verify signature with grapheneos signing key
Expand-Archive graphene.zip -DestinationPath graphene
cd graphene\<DEVICE>-factory-<DATE>
```

Aktualne release tags: <https://grapheneos.org/releases>

### 3.5 Unlock bootloader

```powershell
fastboot flashing unlock
# confirm on device with Vol Down → Power
```

### 3.6 Flash

```powershell
.\flash-all.bat
```

Skrypt flashuje boot, system, vendor, dtbo, vbmeta i wykonuje wipe userdata.

### 3.7 Lock bootloader

```powershell
fastboot flashing lock
# confirm on device → device wipes again
```

### 3.8 First boot

Power button → GrapheneOS welcome.

---

## 4. Verification po reinstalacji

### 4.1 Verified Boot status

```text
Settings → Security → Verified Boot status
  → Expected: "Verified Boot is active and using the device's hardware-backed keys"
```

Jeśli "yellow" lub "orange" → bootloader nie został zalocked po flashu → wróć do §2.4 lock step.

### 4.2 OS version

```text
Settings → About phone → Android version
  → Expected: GrapheneOS <release-date>
```

### 4.3 Brak app residual z poprzednich prób

```text
Settings → Apps → See all apps
  → Expected: tylko system apps + Vanadium, Auditor, Camera, etc. (GrapheneOS defaults)
  → Nie powinno być: Google Play Services, dowolne user-installed apps z poprzedniej sesji
```

### 4.4 Brak Google sign-in

```text
Settings → Passwords & accounts
  → Expected: empty (no Google account, no other accounts)
```

### 4.5 Network identity check (przed konfiguracją SYLION)

W terminalu Vanadium otwórz https://ipinfo.io żeby zobaczyć obecny ASN/IP. Spisz dla audytu (chcesz mieć baseline przed pierwszym połączeniem przez Puli AX).

---

## 5. Hardening setup (przed enrollment do SYLION)

Wszystkie kroki w **Settings**:

```text
Security → Lock screen → PIN/passphrase (min 8 chars, NOT alphanumeric default)
  → Lock after sleep: immediately
  → Power button locks: enable

Security → Exploit protection
  → Hardened malloc: enable (default)
  → Native code debugging: disable

Security → Auto reboot
  → Enable: 18h or shorter (BFU state reset)

Privacy
  → Sensors off (panic toggle): enable in quick tiles
  → Show passwords: disable

Apps → Special app access → Display over other apps: review (none should have)
Apps → Special app access → Install unknown apps: deny all by default

Network & internet → SIM → mobile data: DISABLED initially (operator decides per profile)
Network & internet → Wi-Fi → forget all saved networks except SYLION operator SSIDs
Network & internet → VPN → (will be configured by SYLION enrollment workflow later)

Notifications → On lock screen: hide sensitive content

Apps → Vanadium (default browser)
  → DNS over HTTPS: built-in (default)
  → JavaScript: site-by-site enable per workflow
```

---

## 6. Following steps (SYLION operator enrollment)

Po wipe + GrapheneOS + hardening:

1. **Inwentaryzacja** w SYLION admin panel: Devices → Register Pixel (rejestruj model, serial, GrapheneOS build hash, attestation key).
2. **Operator assignment**: tenant admin assigns Pixel do konkretnego operatora.
3. **Provisioning** (gdy production-ready): admin uruchamia provisioning plan → Pixel dostaje SYLION app + IPsec config + initial enrollment QR.
4. **First operator login**: na Pixelu → SYLION app → scan enrollment QR → first FIDO2 setup (Titan M2 jako built-in security key).
5. **Verify** w admin panel: device posture = healthy, attestation passed.

Patrz osobne runbooki gdy będą gotowe:
- `pixel-enrollment.md` (TBD)
- `operator-first-login.md` (TBD)

---

## 7. Troubleshooting

| Problem | Diagnoza | Rozwiązanie |
|---|---|---|
| Web installer "No device found" | USB cable jest tylko-power, nie data | Użyj oryginalnego kabla USB-C Pixela lub innego data-capable |
| Web installer timeout | Chrome WebUSB permission denied | Reset permission: chrome://settings/content/usbDevices |
| "Could not unlock bootloader" | OEM unlocking grayed out | Carrier-locked device — wymiana na unlocked |
| Pixel po flash zboot do bootloader loop | Flash incomplete | Ponów `.\flash-all.bat` (CLI) lub "Flash release" (web) |
| Verified Boot yellow/orange | Bootloader nie zalocked | Wykonaj §2.4 lub §3.7 lock step |
| First boot do "device corrupt" red screen | Mismatch między signed image a slot | Pełny re-flash z aktualnego factory image |
| `fastboot` not found | platform-tools nie w PATH | `winget install --id Google.PlatformTools` + restart shell |

---

## 8. Security notes

- **Web installer (Ścieżka A) używa GrapheneOS signed factory image** + Verified Boot. Bezpieczne nawet jeśli komputer hostujący wipe jest mniej zaufany — kompromis lokalnego Chrome to mniejsze ryzyko niż downloading random APK.
- **Lock bootloader po flashu jest OBOWIĄZKOWY**. Pixel z unlocked bootloader to bypass dla forensic tools (XRY, Cellebrite) per Analiza Zagrożeń §4.4.1. SYLION wymaga locked Verified Boot.
- **Brak Google sign-in** — GrapheneOS domyślnie nie ma Google services. Jeśli operator potrzebuje konkretnej Google-dependent funkcji, użyj sandboxed Google Play (Settings → Apps → Install Google Play services).
- **Auto-reboot 18h** sprowadza Pixel do BFU (Before First Unlock) state → maksymalna ochrona przed Cellebrite per Analiza §4.4.1.

---

## Appendix A — Linki

- GrapheneOS install guide (web): https://grapheneos.org/install/web
- GrapheneOS install guide (CLI): https://grapheneos.org/install/cli
- GrapheneOS supported devices: https://grapheneos.org/faq#supported-devices
- GrapheneOS releases: https://grapheneos.org/releases
- Android Platform Tools: https://developer.android.com/tools/releases/platform-tools
- Auditor app (attestation): https://attestation.app/

## Appendix B — SYLION references

- `SYLION_PHANTOM_v3.0.docx` §1.1, §4.4 (Pixel as terminal, evil-maid mitigation)
- `SYLION-Analiza-Zagrozen-COMPLETE.pdf` §4.4.1 (forensic tools), R1 (baseband off), R2 (cert IPsec + FIDO2)
- `shared/references/hardware-gates.md` — device qualification gates
- `adr/ADR-router-phantom-001.md` REVISED — Puli AX baseline router (do którego Pixel się łączy via WiFi)
- `adr/ADR-terminal-modes-001.md` (do utworzenia) — two terminal modes (Pixel + laptop browser)
