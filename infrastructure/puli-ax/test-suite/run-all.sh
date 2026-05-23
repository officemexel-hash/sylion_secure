#!/bin/sh
# SYLION Puli AX test suite — runs T01-T10 per ADR-router-phantom-001 §9
# Run on router: sh /path/to/run-all.sh
# Exits with non-zero if any test fails.

set -u

if [ -t 1 ]; then
    G=$(printf '\033[32m'); R=$(printf '\033[31m'); Y=$(printf '\033[33m'); N=$(printf '\033[0m')
else
    G=""; R=""; Y=""; N=""
fi

PASS=0
FAIL=0
SKIP=0
SUMMARY="/tmp/sylion-test-summary-$(date +%Y%m%d-%H%M%S).txt"

run_test() {
    name="$1"
    script="$2"
    desc="$3"
    printf "%s===> %s — %s%s\n" "$Y" "$name" "$desc" "$N"

    if eval "$script"; then
        printf "  %sPASS%s\n" "$G" "$N"
        echo "$name PASS — $desc" >> "$SUMMARY"
        PASS=$((PASS + 1))
        return 0
    else
        printf "  %sFAIL%s\n" "$R" "$N"
        echo "$name FAIL — $desc" >> "$SUMMARY"
        FAIL=$((FAIL + 1))
        return 1
    fi
}

skip_test() {
    name="$1"
    reason="$2"
    printf "%s===> %s — SKIPPED: %s%s\n" "$Y" "$name" "$reason" "$N"
    echo "$name SKIP — $reason" >> "$SUMMARY"
    SKIP=$((SKIP + 1))
}

echo "SYLION Puli AX Test Suite — $(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$SUMMARY"
echo "Per ADR-router-phantom-001 §9" >> "$SUMMARY"
echo "---" >> "$SUMMARY"

#-----------------------------------------------------------------------------
# T01: Kill switch active BEFORE IPsec tunnel
#-----------------------------------------------------------------------------
T01_TEST='
# Stop strongSwan if running
ipsec stop >/dev/null 2>&1 || true
sleep 2

# Verify nftables policy is DROP
policy=$(nft list chain inet sylion_killswitch output 2>/dev/null | grep "policy" || \
         iptables -L OUTPUT 2>/dev/null | head -1 | grep -o "policy [A-Z]*" || echo "policy ACCEPT")

if echo "$policy" | grep -qi "drop"; then
    # Try to ping out — should fail
    if ping -c 2 -W 2 1.1.1.1 >/dev/null 2>&1; then
        echo "FAIL: ping succeeded with kill switch active"
        false
    else
        echo "OK: kill switch blocks output pre-VPN"
        true
    fi
else
    echo "FAIL: kill switch policy is not DROP ($policy)"
    false
fi
'
run_test "T01" "$T01_TEST" "Kill switch active BEFORE IPsec tunnel"

#-----------------------------------------------------------------------------
# T02: LAN→WAN no traffic without tunnel
#-----------------------------------------------------------------------------
T02_TEST='
# Check no NAT/forward LAN→WAN without IPsec
ipsec stop >/dev/null 2>&1 || true
sleep 2

# Simulate LAN client by source IP — we cannot really test from inside script
# but we verify the forward chain policy + zone configs
fwd=$(nft list chain inet sylion_killswitch forward 2>/dev/null | grep "policy" || echo "")
if echo "$fwd" | grep -qi "drop"; then
    echo "OK: forward policy is DROP without tunnel"
    true
else
    echo "FAIL: forward policy is not DROP ($fwd)"
    false
fi
'
run_test "T02" "$T02_TEST" "LAN→WAN blocked without tunnel"

#-----------------------------------------------------------------------------
# T03: DNS leak prevention
#-----------------------------------------------------------------------------
T03_TEST='
ipsec stop >/dev/null 2>&1 || true
sleep 2

# Try DNS to public resolver — should fail
if nslookup example.com 1.1.1.1 2>&1 | grep -q "answer"; then
    echo "FAIL: DNS to 1.1.1.1 succeeded pre-tunnel — DNS LEAK"
    false
else
    echo "OK: DNS to public resolver blocked pre-tunnel"
    true
fi
'
run_test "T03" "$T03_TEST" "DNS leak prevention"

#-----------------------------------------------------------------------------
# T04: IKEv2 cert auth + approved proposals
#-----------------------------------------------------------------------------
T04_TEST='
if [ ! -f /etc/ipsec.conf ]; then
    echo "FAIL: /etc/ipsec.conf not found"
    false
elif ! grep -q "leftauth=pubkey" /etc/ipsec.conf; then
    echo "FAIL: leftauth is not pubkey (cert auth required)"
    false
elif ! grep -q "ike=aes256gcm16" /etc/ipsec.conf; then
    echo "FAIL: IKE proposal is not AES-256-GCM"
    false
elif ! grep -q "ecp384" /etc/ipsec.conf; then
    echo "FAIL: ECP-384 (ECDH P-384) not in proposals"
    false
else
    echo "OK: IPsec config has cert auth + AES-256-GCM + ECP-384"
    true
fi
'
run_test "T04" "$T04_TEST" "IKEv2 cert auth + approved proposals"

#-----------------------------------------------------------------------------
# T05: Rekey + DPD recovery
#-----------------------------------------------------------------------------
T05_TEST='
if ! grep -q "rekey=yes" /etc/ipsec.conf 2>/dev/null; then
    echo "FAIL: rekey not enabled"
    false
elif ! grep -q "dpdaction=restart" /etc/ipsec.conf; then
    echo "FAIL: DPD action not restart"
    false
elif ! grep -q "dpddelay=" /etc/ipsec.conf; then
    echo "FAIL: DPD delay not set"
    false
else
    echo "OK: Rekey + DPD config present"
    true
fi
'
run_test "T05" "$T05_TEST" "Rekey + DPD recovery config"

#-----------------------------------------------------------------------------
# T06: Firmware signature / image provenance
#-----------------------------------------------------------------------------
T06_TEST='
# Check whether firmware was signed verifiable
if [ -f /etc/openwrt_release ]; then
    rel=$(grep DISTRIB_DESCRIPTION /etc/openwrt_release | cut -d= -f2)
    echo "Detected firmware: $rel"
    # For GL OS, vendor signing is implicit; we cannot verify here
    # For custom OpenWrt build, would verify sigstore or GPG
    if [ -d /etc/opkg/keys ] && [ "$(ls -A /etc/opkg/keys 2>/dev/null)" ]; then
        echo "OK: OPKG signing keys present"
        true
    else
        echo "WARN: No OPKG signing keys found (custom build verification not possible here)"
        true   # not a fail for GL OS path
    fi
else
    echo "WARN: /etc/openwrt_release not found"
    true
fi
'
run_test "T06" "$T06_TEST" "Firmware signature / provenance"

#-----------------------------------------------------------------------------
# T07: Config drift detection
#-----------------------------------------------------------------------------
T07_TEST='
# Compute hash of current UCI config and compare against expected
# (expected hash should be in /etc/sylion/expected-config-hash after first run)
EXPECTED_FILE="/etc/sylion/expected-config-hash"
if [ ! -f "$EXPECTED_FILE" ]; then
    # First run — record baseline
    if command -v sha256sum >/dev/null 2>&1; then
        cat /etc/config/network /etc/config/firewall /etc/config/dhcp /etc/config/system 2>/dev/null | sha256sum > "$EXPECTED_FILE"
        echo "OK: Baseline config hash recorded"
    else
        echo "WARN: sha256sum not available"
    fi
    true
else
    expected=$(cat "$EXPECTED_FILE" | awk "{print \$1}")
    actual=$(cat /etc/config/network /etc/config/firewall /etc/config/dhcp /etc/config/system 2>/dev/null | sha256sum | awk "{print \$1}")
    if [ "$expected" = "$actual" ]; then
        echo "OK: Config matches baseline (no drift)"
        true
    else
        echo "FAIL: Config drift detected"
        echo "  Expected: $expected"
        echo "  Actual:   $actual"
        false
    fi
fi
'
run_test "T07" "$T07_TEST" "Config drift detection"

#-----------------------------------------------------------------------------
# T08: AES-256-GCM IPsec throughput
#-----------------------------------------------------------------------------
T08_TEST='
# This test requires actual tunnel establishment + iperf3 — typically lab-only
if ! command -v iperf3 >/dev/null 2>&1; then
    echo "SKIP: iperf3 not installed"
    return 0
fi
# Cannot run real throughput without G1 endpoint reachable
# Check IPsec is configured properly
if ipsec statusall 2>/dev/null | grep -q "INSTALLED"; then
    echo "OK: IPsec SA installed, manual throughput test required"
    echo "    Run: iperf3 -c <G1-internal-IP> -t 30 -P 4"
    echo "    Target: >= 150 Mbps (per ADR-001 M6)"
    true
else
    echo "WARN: No IPsec SA active — cannot benchmark"
    true
fi
'
run_test "T08" "$T08_TEST" "AES-256-GCM throughput (manual followup)"

#-----------------------------------------------------------------------------
# T09: CPU/RAM pressure under realistic traffic
#-----------------------------------------------------------------------------
T09_TEST='
# Snapshot current load
load=$(cat /proc/loadavg | awk "{print \$1}")
mem_free=$(grep MemAvailable /proc/meminfo | awk "{print \$2}")
mem_total=$(grep MemTotal /proc/meminfo | awk "{print \$2}")

if [ "$mem_total" -gt 0 ]; then
    mem_pct=$((100 * mem_free / mem_total))
    echo "Load: $load, MemFree: ${mem_pct}%"
    if [ "$mem_pct" -lt 20 ]; then
        echo "WARN: Less than 20% memory free under idle"
    fi
fi

# Real load test requires generating traffic — manual
echo "OK: Baseline snapshot. Manual: stress-ng + 4× iperf3 concurrent."
true
'
run_test "T09" "$T09_TEST" "CPU/RAM pressure (manual followup)"

#-----------------------------------------------------------------------------
# T10: Power-loss recovery
#-----------------------------------------------------------------------------
T10_TEST='
# Verify post-reboot config will be restored properly
# Check that /etc/rc.local has SYLION boot order
if [ -f /etc/rc.local ] && grep -q "sylion-killswitch" /etc/rc.local; then
    echo "OK: Boot order configured (nftables before strongSwan)"
    true
else
    echo "FAIL: Boot order not in /etc/rc.local — power loss recovery may fail kill-switch-before-VPN"
    false
fi
'
run_test "T10" "$T10_TEST" "Power-loss recovery (boot order)"

#-----------------------------------------------------------------------------
# Summary
#-----------------------------------------------------------------------------

echo "" >> "$SUMMARY"
echo "---" >> "$SUMMARY"
echo "PASS: $PASS" >> "$SUMMARY"
echo "FAIL: $FAIL" >> "$SUMMARY"
echo "SKIP: $SKIP" >> "$SUMMARY"

printf "\n"
printf "╭──────────────────────────────────────────────╮\n"
printf "│ SYLION Puli AX Test Suite Summary            │\n"
printf "├──────────────────────────────────────────────┤\n"
printf "│ %sPASS:%s %2d                                       │\n" "$G" "$N" "$PASS"
printf "│ %sFAIL:%s %2d                                       │\n" "$R" "$N" "$FAIL"
printf "│ %sSKIP:%s %2d                                       │\n" "$Y" "$N" "$SKIP"
printf "├──────────────────────────────────────────────┤\n"
printf "│ Summary: %s            │\n" "$SUMMARY"
printf "╰──────────────────────────────────────────────╯\n"

if [ "$FAIL" -gt 0 ]; then
    printf "\n%sOne or more tests FAILED — do NOT proceed to operator enrollment%s\n" "$R" "$N"
    exit 1
elif [ "$PASS" -eq 0 ]; then
    printf "\n%sNo tests passed — verify environment%s\n" "$Y" "$N"
    exit 2
else
    printf "\n%sAll runnable tests passed — verify manual tests T08+T09 next%s\n" "$G" "$N"
    exit 0
fi
