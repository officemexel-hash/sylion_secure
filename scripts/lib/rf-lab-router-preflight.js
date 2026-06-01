const TRUE_VALUE = "true";

function bool(value) {
  return value === true || value === TRUE_VALUE;
}

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseKeyValueLines(output) {
  const result = {};
  for (const raw of String(output || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || !line.includes("=")) continue;
    const [key, ...rest] = line.split("=");
    result[key] = rest.join("=");
  }
  return result;
}

export function buildReadOnlyRfLabPreflightScript() {
  return `
set -eu
pkg_present() {
  if command -v opkg >/dev/null 2>&1; then
    opkg list-installed 2>/dev/null | awk '{print $1}' | grep -Ex "$1" >/dev/null 2>&1 && echo true || echo false
  else
    echo false
  fi
}
cmd_present() {
  command -v "$1" >/dev/null 2>&1 && echo true || echo false
}
echo hostname="$(cat /proc/sys/kernel/hostname 2>/dev/null | tr -cd '[:alnum:]._:-' || echo unknown)"
echo kernel="$(uname -r 2>/dev/null | tr -cd '[:alnum:]._:+/-' || echo unknown)"
echo arch="$(uname -m 2>/dev/null | tr -cd '[:alnum:]._:-' || echo unknown)"
echo opkg_present="$(cmd_present opkg)"
echo python3_present="$(cmd_present python3)"
echo pip3_present="$(cmd_present pip3)"
echo pcscd_present="$(cmd_present pcscd)"
echo pcsc_scan_present="$(cmd_present pcsc_scan)"
echo opensc_tool_present="$(cmd_present opensc-tool)"
echo lsusb_present="$(cmd_present lsusb)"
echo pysim_shell_present="$({ command -v pySim-shell.py >/dev/null 2>&1 || command -v pysim-shell >/dev/null 2>&1; } && echo true || echo false)"
echo package_python3="$(pkg_present python3)"
echo package_pcscd="$(pkg_present pcscd)"
echo package_libpcsclite="$(pkg_present libpcsclite)"
echo package_ccid="$(pkg_present ccid)"
echo package_opensc="$(pkg_present opensc)"
echo package_opensc_util="$(pkg_present opensc-util)"
echo usb_bus_present="$([ -d /dev/bus/usb ] && echo true || echo false)"
usb_lines="$(lsusb 2>/dev/null || true)"
echo usb_device_count="$(printf '%s\\n' "$usb_lines" | sed '/^$/d' | wc -l | tr -d ' ')"
echo smartcard_reader_hint="$(printf '%s\\n' "$usb_lines" | grep -Eiq 'smart|ccid|reader|sysmo|simtrace|card' && echo true || echo false)"
echo rf_lab_preflight_read_only=true
echo raw_cellular_identifiers_read=false
echo sim_secret_material_read=false
echo mutation_commands_executed=false
echo product_runtime_executor_available=false
`;
}

export function summarizeRfLabRouterPreflight(kv, {
  routerIp = null,
  startedAt = null,
  completedAt = null
} = {}) {
  const capabilities = {
    opkgPresent: bool(kv.opkg_present),
    python3Present: bool(kv.python3_present) || bool(kv.package_python3),
    pip3Present: bool(kv.pip3_present),
    pcscdPresent: bool(kv.pcscd_present) || bool(kv.package_pcscd),
    pcscScanPresent: bool(kv.pcsc_scan_present),
    openscToolPresent: bool(kv.opensc_tool_present),
    pcscLibraryPresent: bool(kv.package_libpcsclite),
    ccidPackagePresent: bool(kv.package_ccid),
    openscPackagePresent: bool(kv.package_opensc) || bool(kv.package_opensc_util),
    pysimShellPresent: bool(kv.pysim_shell_present),
    usbBusPresent: bool(kv.usb_bus_present),
    lsusbPresent: bool(kv.lsusb_present),
    smartcardReaderHint: bool(kv.smartcard_reader_hint),
    usbDeviceCount: numberValue(kv.usb_device_count)
  };
  const controls = {
    readOnly: bool(kv.rf_lab_preflight_read_only),
    rawCellularIdentifiersRead: bool(kv.raw_cellular_identifiers_read),
    simSecretMaterialRead: bool(kv.sim_secret_material_read),
    mutationCommandsExecuted: bool(kv.mutation_commands_executed),
    productRuntimeExecutorAvailable: bool(kv.product_runtime_executor_available),
    sideEffectAllowed: false,
    productionExecutionAllowed: false,
    passwordPrinted: false,
    secretsStored: false
  };
  const pcscStackPresent = capabilities.pcscdPresent
    && capabilities.pcscLibraryPresent
    && (capabilities.ccidPackagePresent || capabilities.openscPackagePresent || capabilities.openscToolPresent);
  const labToolingReady = capabilities.python3Present
    && capabilities.pysimShellPresent
    && pcscStackPresent
    && capabilities.usbBusPresent
    && capabilities.smartcardReaderHint;
  const blockers = [
    ...(capabilities.python3Present ? [] : ["python3_missing"]),
    ...(capabilities.pysimShellPresent ? [] : ["pysim_shell_missing"]),
    ...(pcscStackPresent ? [] : ["pcsc_ccid_stack_missing"]),
    ...(capabilities.usbBusPresent ? [] : ["usb_bus_not_visible"]),
    ...(capabilities.smartcardReaderHint ? [] : ["smartcard_reader_not_detected"]),
    ...(controls.readOnly ? [] : ["preflight_read_only_flag_missing"]),
    ...(controls.rawCellularIdentifiersRead ? ["raw_cellular_identifier_read_detected"] : []),
    ...(controls.simSecretMaterialRead ? ["sim_secret_material_read_detected"] : []),
    ...(controls.mutationCommandsExecuted ? ["mutation_command_execution_detected"] : []),
    ...(controls.productRuntimeExecutorAvailable ? ["product_runtime_executor_must_remain_absent"] : []),
    "faraday_cage_evidence_required",
    "legal_ciso_architect_hardware_approval_required"
  ];
  return {
    component: "puli_ax_rf_lab_router_preflight",
    routerIp,
    startedAt,
    completedAt,
    status: labToolingReady ? "preflight_ready_for_human_gate" : "preflight_captured_with_blockers",
    facts: {
      hostname: kv.hostname || "unknown",
      kernel: kv.kernel || "unknown",
      arch: kv.arch || "unknown",
      capabilities
    },
    controls,
    blockers,
    nextActions: [
      "Attach this read-only preflight to an RF lab test request.",
      "Keep SIM programming outside product runtime and inside an approved shielded lab only.",
      "Record only hashes, evidence references and pass/fail metadata; never store raw cellular identifiers or SIM secret material."
    ]
  };
}

export function assertRfLabPreflightSafe(summary) {
  const serialized = JSON.stringify(summary);
  if (/\b\d{14,20}\b/.test(serialized)) {
    throw new Error("RF lab preflight summary contains a raw cellular identifier-like value");
  }
  if (summary?.controls?.rawCellularIdentifiersRead === true
    || summary?.controls?.simSecretMaterialRead === true
    || summary?.controls?.mutationCommandsExecuted === true
    || summary?.controls?.productRuntimeExecutorAvailable === true) {
    throw new Error("RF lab preflight summary indicates a forbidden side effect");
  }
  return summary;
}
