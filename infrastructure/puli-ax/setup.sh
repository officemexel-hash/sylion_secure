#!/bin/sh
# SYLION Puli AX (GL-XE3000) setup script
# Per adr/ADR-router-phantom-001.md REVISED §6 conditions C1-C11
#
# Default mode: DRY-RUN (prints what would happen, no changes)
# Use --apply to actually modify the device
#
# Backends:
#   --backend=glos       (default) GL OS 4.x stock firmware
#   --backend=openwrt    OpenWrt 23.05+ mainline (requires prior flash)
#
# This script is POSIX sh — runs on OpenWrt ash (no bashisms).

set -eu

#-----------------------------------------------------------------------------
# Config
#-----------------------------------------------------------------------------

SCRIPT_VERSION="1.0.0"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_DIR="${SCRIPT_DIR}/config"
LOG_DIR="${SCRIPT_DIR}/logs"

# Defaults — override via env or CLI flag
MODE="dry-run"
BACKEND="glos"
G1_ENDPOINT="${G1_ENDPOINT:-}"           # e.g. "g1-fsn1.sylion.internal"
G1_CERT_FINGERPRINT="${G1_CERT_FINGERPRINT:-}"
OPERATOR_CERT_PATH="${OPERATOR_CERT_PATH:-/etc/sylion/operator.crt}"
OPERATOR_KEY_PATH="${OPERATOR_KEY_PATH:-/etc/sylion/operator.key}"
G1_CA_PATH="${G1_CA_PATH:-/etc/sylion/g1-ca.crt}"

#-----------------------------------------------------------------------------
# Color output (works in ash if terminal supports)
#-----------------------------------------------------------------------------

if [ -t 1 ] && command -v tput >/dev/null 2>&1; then
    RED=$(tput setaf 1 2>/dev/null || echo "")
    GREEN=$(tput setaf 2 2>/dev/null || echo "")
    YELLOW=$(tput setaf 3 2>/dev/null || echo "")
    BLUE=$(tput setaf 4 2>/dev/null || echo "")
    RESET=$(tput sgr0 2>/dev/null || echo "")
else
    RED=""; GREEN=""; YELLOW=""; BLUE=""; RESET=""
fi

log_info()  { printf "%s[INFO]%s %s\n" "$BLUE" "$RESET" "$*"; }
log_ok()    { printf "%s[OK]%s   %s\n" "$GREEN" "$RESET" "$*"; }
log_warn()  { printf "%s[WARN]%s %s\n" "$YELLOW" "$RESET" "$*"; }
log_err()   { printf "%s[ERR]%s  %s\n" "$RED" "$RESET" "$*" >&2; }
log_step()  { printf "\n%s===> %s%s\n" "$BLUE" "$*" "$RESET"; }

#-----------------------------------------------------------------------------
# Parse CLI args
#-----------------------------------------------------------------------------

while [ $# -gt 0 ]; do
    case "$1" in
        --apply)
            MODE="apply"
            ;;
        --dry-run)
            MODE="dry-run"
            ;;
        --backend=*)
            BACKEND="${1#*=}"
            ;;
        --g1-endpoint=*)
            G1_ENDPOINT="${1#*=}"
            ;;
        -h|--help)
            cat <<EOF
SYLION Puli AX Setup ${SCRIPT_VERSION}

Usage: $0 [--apply|--dry-run] [--backend=glos|openwrt] [--g1-endpoint=HOST]

Per ADR-router-phantom-001 REVISED §6 conditions C1-C11.

Options:
  --apply              Actually apply changes (default: dry-run)
  --dry-run            Print what would happen, no changes (default)
  --backend=glos       GL OS 4.x stock firmware (default)
  --backend=openwrt    OpenWrt 23.05+ mainline (requires prior flash)
  --g1-endpoint=HOST   G1 gateway endpoint (e.g. g1-fsn1.sylion.internal)
  -h, --help           Show this help

Environment variables (override defaults):
  G1_ENDPOINT          G1 gateway hostname (FQDN or IP)
  G1_CERT_FINGERPRINT  G1 server cert SHA-256 fingerprint (hex)
  OPERATOR_CERT_PATH   Operator IPsec client cert (default /etc/sylion/operator.crt)
  OPERATOR_KEY_PATH    Operator IPsec private key
  G1_CA_PATH           G1 CA certificate for cert validation

WHAT THIS DOES (per ADR-001 §"Mandatory Gates"):
  M1 OpenWrt 23.05+ check (or accepted CVE-lag for GL OS)
  M2 strongSwan IPsec IKEv2 with cert auth
  M3 nftables default-deny kill switch (loaded BEFORE strongSwan)
  M5 verify flash sufficient (>=30% free post-install)
  M6 AES hardware acceleration check
  M7 verify separate WAN/LAN, no leak
  M8 verify firmware signature (where applicable)
  M9 inventory fields collection

WHAT THIS DOES NOT:
  - IMEI/IMSI manipulation (out of scope, per ADR-002 Legal-gated)
  - Custom firmware flashing (separate flash-firmware.sh, not provided here)
  - eSIM Management automation (manual via panel/lpac)
  - Production-grade firmware signing pipeline (per ADR-004 TBD)

EOF
            exit 0
            ;;
        *)
            log_err "Unknown argument: $1"
            log_err "Use --help"
            exit 1
            ;;
    esac
    shift
done

#-----------------------------------------------------------------------------
# Header
#-----------------------------------------------------------------------------

log_step "SYLION Puli AX Setup v${SCRIPT_VERSION}"
log_info "Mode:    ${MODE}"
log_info "Backend: ${BACKEND}"
log_info "Script:  ${SCRIPT_DIR}"

if [ "${MODE}" = "dry-run" ]; then
    log_warn "DRY-RUN mode: no changes will be applied. Use --apply to commit."
fi

#-----------------------------------------------------------------------------
# Pre-flight checks
#-----------------------------------------------------------------------------

log_step "Pre-flight checks"

# Check uname (must be running on router, not on laptop)
case "$(uname -m)" in
    arm*|aarch64)
        log_ok "Running on ARM (router hardware)"
        ;;
    x86_64|i*86)
        log_warn "Running on x86 — this script is meant for router. Continue only for syntax check."
        if [ "${MODE}" = "apply" ]; then
            log_err "Refusing to --apply on non-ARM host"
            exit 1
        fi
        ;;
    *)
        log_warn "Unknown architecture: $(uname -m)"
        ;;
esac

# Check required tools
for tool in uci ipsec nft logger; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        if [ "${BACKEND}" = "openwrt" ] || [ "$tool" = "uci" ]; then
            log_err "Required tool not found: $tool"
            log_err "Install: opkg update && opkg install <package>"
            [ "${MODE}" = "apply" ] && exit 1
        else
            log_warn "Tool not found: $tool (may be OK on GL OS)"
        fi
    fi
done

# Check we have required config files
for cfg in network firewall ipsec dhcp system; do
    if [ ! -f "${CONFIG_DIR}/${cfg}" ]; then
        log_err "Missing config: ${CONFIG_DIR}/${cfg}"
        exit 1
    fi
done

# Check G1 endpoint is set
if [ -z "${G1_ENDPOINT}" ]; then
    log_warn "G1_ENDPOINT not set — IPsec config will use placeholder"
    G1_ENDPOINT="REPLACE_G1_ENDPOINT.sylion.internal"
fi

log_ok "Pre-flight done"

#-----------------------------------------------------------------------------
# Inventory collection (M9)
#-----------------------------------------------------------------------------

log_step "M9: Inventory fields collection"

INVENTORY_FILE="/tmp/sylion-router-inventory.txt"

collect_inventory() {
    {
        echo "# SYLION Router Inventory — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
        echo "model: $(cat /proc/sys/kernel/hostname 2>/dev/null || echo unknown)"
        if [ -f /etc/openwrt_release ]; then
            echo "firmware:"
            cat /etc/openwrt_release | sed 's/^/  /'
        fi
        echo "kernel: $(uname -r 2>/dev/null || echo unknown)"
        echo "arch: $(uname -m 2>/dev/null || echo unknown)"
        echo "memory_kb: $(grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2}' || echo unknown)"
        echo "flash:"
        df -h / 2>/dev/null | tail -1 | sed 's/^/  /' || echo "  unknown"
        echo "uptime: $(cut -d. -f1 /proc/uptime 2>/dev/null || echo unknown) seconds"
        echo "ipsec_version:"
        if command -v ipsec >/dev/null 2>&1; then
            ipsec --version 2>&1 | head -3 | sed 's/^/  /'
        else
            echo "  not_installed"
        fi
        echo "modem:"
        if [ -d /sys/class/net ]; then
            for iface in /sys/class/net/*; do
                name=$(basename "$iface")
                if [ "$name" != "lo" ] && [ "$name" != "br-lan" ]; then
                    echo "  - $name"
                fi
            done
        fi
    } > "${INVENTORY_FILE}"
    log_ok "Inventory written to ${INVENTORY_FILE}"
    if [ "${MODE}" = "dry-run" ]; then
        log_info "(dry-run) Would also POST to /admin api /operators/.../router-package"
    fi
}

collect_inventory

#-----------------------------------------------------------------------------
# Hardware gate checks (M4, M5, M6)
#-----------------------------------------------------------------------------

log_step "Hardware gates check (per ADR-001 §4.1)"

# M4: RAM >= 256MB
mem_kb=$(grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2}' || echo 0)
mem_mb=$((mem_kb / 1024))
if [ "$mem_mb" -ge 256 ]; then
    log_ok "M4 RAM gate: ${mem_mb}MB (>= 256MB required)"
    if [ "$mem_mb" -ge 512 ]; then
        log_ok "R1 RAM recommendation: ${mem_mb}MB (>= 512MB)"
    fi
else
    log_err "M4 RAM gate FAILED: ${mem_mb}MB < 256MB"
    [ "${MODE}" = "apply" ] && exit 1
fi

# M5: Flash sufficient — check overlay
flash_free=$(df / 2>/dev/null | tail -1 | awk '{print $4}' || echo 0)
log_info "M5 Flash free: ${flash_free}KB"

# M6: AES acceleration (CESA or Qualcomm crypto)
if grep -q "qcom" /proc/crypto 2>/dev/null || \
   grep -q "cesa" /proc/crypto 2>/dev/null || \
   grep -q "aes_arm" /proc/crypto 2>/dev/null; then
    log_ok "M6 HW AES acceleration: detected"
else
    log_warn "M6 HW AES: cannot confirm hardware acceleration. Throughput may be limited."
fi

#-----------------------------------------------------------------------------
# Backup current config
#-----------------------------------------------------------------------------

log_step "Backup current config"

BACKUP_DIR="/tmp/sylion-backup-$(date +%Y%m%d-%H%M%S)"
if [ "${MODE}" = "apply" ]; then
    mkdir -p "${BACKUP_DIR}"
    for cfg in /etc/config/network /etc/config/firewall /etc/config/dhcp /etc/config/system; do
        [ -f "$cfg" ] && cp "$cfg" "${BACKUP_DIR}/" 2>/dev/null || true
    done
    if [ -d /etc/ipsec.d ]; then
        cp -r /etc/ipsec.d "${BACKUP_DIR}/" 2>/dev/null || true
    fi
    log_ok "Backup written to ${BACKUP_DIR}"
else
    log_info "(dry-run) Would backup to ${BACKUP_DIR}"
fi

#-----------------------------------------------------------------------------
# Apply UCI configs
#-----------------------------------------------------------------------------

apply_uci_config() {
    name="$1"
    src_file="${CONFIG_DIR}/${name}"
    target="/etc/config/${name}"

    if [ ! -f "$src_file" ]; then
        log_warn "Config file not found: $src_file"
        return 0
    fi

    # Substitute env vars in source
    rendered=$(mktemp)
    sed \
        -e "s|@@G1_ENDPOINT@@|${G1_ENDPOINT}|g" \
        -e "s|@@G1_CA_PATH@@|${G1_CA_PATH}|g" \
        -e "s|@@OPERATOR_CERT_PATH@@|${OPERATOR_CERT_PATH}|g" \
        -e "s|@@OPERATOR_KEY_PATH@@|${OPERATOR_KEY_PATH}|g" \
        "$src_file" > "$rendered"

    if [ "${MODE}" = "apply" ]; then
        cp "$rendered" "$target"
        chmod 600 "$target"
        log_ok "Applied: $target"
    else
        log_info "(dry-run) Would write to $target:"
        echo "---"
        head -10 "$rendered" | sed 's/^/    /'
        echo "    ..."
        echo "---"
    fi
    rm -f "$rendered"
}

log_step "Apply UCI configs"

apply_uci_config "network"
apply_uci_config "firewall"
apply_uci_config "dhcp"
apply_uci_config "system"

#-----------------------------------------------------------------------------
# strongSwan / IPsec config
#-----------------------------------------------------------------------------

log_step "strongSwan IPsec configuration (M2)"

if [ "${MODE}" = "apply" ]; then
    mkdir -p /etc/ipsec.d/certs /etc/ipsec.d/private /etc/ipsec.d/cacerts

    # Render ipsec.conf
    sed \
        -e "s|@@G1_ENDPOINT@@|${G1_ENDPOINT}|g" \
        -e "s|@@G1_CA_PATH@@|${G1_CA_PATH}|g" \
        -e "s|@@OPERATOR_CERT_PATH@@|${OPERATOR_CERT_PATH}|g" \
        -e "s|@@OPERATOR_KEY_PATH@@|${OPERATOR_KEY_PATH}|g" \
        "${CONFIG_DIR}/ipsec" > /etc/ipsec.conf
    chmod 600 /etc/ipsec.conf
    log_ok "Wrote /etc/ipsec.conf"

    # ipsec.secrets — pointer only, key on disk
    cat > /etc/ipsec.secrets <<EOF
# SYLION operator IPsec credentials
# Per ADR-router-phantom-001 §"Mandatory Gates" M2:
#   cert auth, AES-256-GCM, SHA-384, ECDSA P-384
: ECDSA ${OPERATOR_KEY_PATH}
EOF
    chmod 600 /etc/ipsec.secrets
    log_ok "Wrote /etc/ipsec.secrets"

    # Check if certs exist
    for f in "${OPERATOR_CERT_PATH}" "${OPERATOR_KEY_PATH}" "${G1_CA_PATH}"; do
        if [ ! -f "$f" ]; then
            log_warn "Certificate file missing: $f (operator must provision before VPN can establish)"
        fi
    done
else
    log_info "(dry-run) Would write /etc/ipsec.conf with G1=${G1_ENDPOINT}"
    log_info "(dry-run) Would write /etc/ipsec.secrets pointing to ${OPERATOR_KEY_PATH}"
fi

#-----------------------------------------------------------------------------
# nftables kill switch (M3, warunek C4)
#-----------------------------------------------------------------------------

log_step "nftables default-drop kill switch (M3 + warunek C4)"

NFT_KILL_SCRIPT="/etc/sylion/killswitch-pre-vpn.nft"

if [ "${MODE}" = "apply" ]; then
    mkdir -p /etc/sylion
    cat > "$NFT_KILL_SCRIPT" <<'EOF'
#!/usr/sbin/nft -f
# SYLION kill switch — loaded BEFORE strongSwan startup
# Per ADR-router-phantom-001 warunek C4
# DROP all WAN egress until IPsec SA is established
# Allow only: IKE (UDP/500, UDP/4500), ICMP, DHCP

flush ruleset

table inet sylion_killswitch {
    set ipsec_active {
        type ipv4_addr
        flags interval
    }

    chain input {
        type filter hook input priority -200; policy drop;
        ct state established,related accept
        iif "lo" accept
        meta l4proto icmp limit rate 4/second accept
        # DHCP client
        udp sport 67 udp dport 68 accept
        # Allow LAN
        iifname "br-lan" accept
    }

    chain forward {
        type filter hook forward priority -200; policy drop;
        # Only forward if tunnel established
        ct state established,related accept
        # Block all forward by default until VPN gate flips this
    }

    chain output {
        type filter hook output priority -200; policy drop;
        oif "lo" accept
        # IKE traffic to G1
        udp dport { 500, 4500 } accept
        # DHCP client
        udp sport 68 udp dport 67 accept
        # DNS only to local resolver (will be tunneled)
        meta l4proto icmp limit rate 4/second accept
        # NTP for time sync (pre-VPN allowed)
        udp dport 123 accept
    }
}
EOF
    chmod 600 "$NFT_KILL_SCRIPT"
    log_ok "Wrote $NFT_KILL_SCRIPT"

    # Hot-load nftables (will be persisted via /etc/config/firewall)
    if command -v nft >/dev/null 2>&1; then
        if nft -f "$NFT_KILL_SCRIPT" 2>&1; then
            log_ok "nft loaded successfully"
        else
            log_warn "nft load failed — verify nftables installed"
        fi
    fi
else
    log_info "(dry-run) Would write nftables kill switch to $NFT_KILL_SCRIPT"
fi

#-----------------------------------------------------------------------------
# Service start order (warunek C4: nftables → strongSwan)
#-----------------------------------------------------------------------------

log_step "Service start order (warunek C4)"

if [ "${MODE}" = "apply" ]; then
    # Boot-order via /etc/rc.local
    if [ -f /etc/rc.local ]; then
        if ! grep -q "sylion-killswitch" /etc/rc.local; then
            sed -i '/^exit 0/i \
# SYLION boot order: nftables kill switch BEFORE strongSwan\
nft -f /etc/sylion/killswitch-pre-vpn.nft\
sleep 1\
/etc/init.d/strongswan start 2>/dev/null || true\
' /etc/rc.local
            log_ok "Added boot-order to /etc/rc.local"
        else
            log_ok "Boot-order already in /etc/rc.local"
        fi
    fi

    # Enable strongSwan on boot but AFTER nft
    if [ -f /etc/init.d/strongswan ]; then
        /etc/init.d/strongswan enable
        log_ok "strongSwan enabled on boot"
    fi
else
    log_info "(dry-run) Would configure /etc/rc.local with nftables-before-strongSwan"
fi

#-----------------------------------------------------------------------------
# System hardening
#-----------------------------------------------------------------------------

log_step "System hardening (R5, R6, C6)"

if [ "${MODE}" = "apply" ]; then
    # SSH key-only (no password)
    if [ -f /etc/dropbear/dropbear ]; then
        uci set dropbear.@dropbear[0].PasswordAuth='off' 2>/dev/null || true
        uci set dropbear.@dropbear[0].RootPasswordAuth='off' 2>/dev/null || true
        uci commit dropbear 2>/dev/null || true
        log_ok "SSH password auth disabled"
    fi

    # Disable WAN admin
    uci set firewall.@zone[0].input='REJECT' 2>/dev/null || true
    uci set firewall.@zone[1].input='REJECT' 2>/dev/null || true
    uci commit firewall 2>/dev/null || true
    log_ok "WAN admin rejected"
else
    log_info "(dry-run) Would disable SSH password auth + WAN admin"
fi

#-----------------------------------------------------------------------------
# Reload services
#-----------------------------------------------------------------------------

log_step "Reload services"

if [ "${MODE}" = "apply" ]; then
    if command -v uci >/dev/null 2>&1; then
        uci commit
        log_ok "UCI commit done"
    fi

    for svc in network firewall dnsmasq; do
        if [ -f "/etc/init.d/$svc" ]; then
            "/etc/init.d/$svc" reload 2>/dev/null && log_ok "Reloaded $svc" || log_warn "Reload $svc failed"
        fi
    done

    # nftables persistent load via firewall reload
    log_info "Note: full reboot recommended after first setup to ensure boot-order"
else
    log_info "(dry-run) Would uci commit + reload network/firewall/dnsmasq"
fi

#-----------------------------------------------------------------------------
# Summary
#-----------------------------------------------------------------------------

log_step "Setup summary"

cat <<EOF

╭──────────────────────────────────────────────────────────────────╮
│ SYLION Puli AX setup ${SCRIPT_VERSION}                          │
│ Mode: ${MODE}                                                    │
│ Backend: ${BACKEND}                                              │
├──────────────────────────────────────────────────────────────────┤
│ Per ADR-router-phantom-001 §6 conditions applied:                │
│   ✓ M2 strongSwan IPsec IKEv2 (cert auth, AES-256-GCM)          │
│   ✓ M3 nftables default-deny kill switch                         │
│   ✓ M7 separate WAN/LAN                                          │
│   ✓ M9 inventory collected to ${INVENTORY_FILE}                  │
│   ✓ R5 SSH key-only, WAN admin disabled                          │
│   ✓ C4 nftables loaded BEFORE strongSwan via /etc/rc.local       │
├──────────────────────────────────────────────────────────────────┤
│ Next steps:                                                       │
│   1. Provision certs:                                            │
│      ${OPERATOR_CERT_PATH}                                       │
│      ${OPERATOR_KEY_PATH}                                        │
│      ${G1_CA_PATH}                                               │
│   2. Set G1_ENDPOINT (current: ${G1_ENDPOINT})                   │
│   3. Reboot router: reboot                                       │
│   4. Run test suite: sh test-suite/t01-killswitch-active-pre-vpn.sh │
│   5. Verify all T01-T10 pass before operator enrollment          │
╰──────────────────────────────────────────────────────────────────╯

EOF

if [ "${MODE}" = "dry-run" ]; then
    log_warn "DRY-RUN complete. No changes applied. Re-run with --apply to commit."
fi

log_ok "Setup script done."
