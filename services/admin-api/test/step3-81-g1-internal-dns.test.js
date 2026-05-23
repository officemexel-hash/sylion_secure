import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  g1DnsPlan,
  renderDnsmasqConfig,
  renderRemoteScript
} from "../../../scripts/install-g1-internal-dns.mjs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));

test("Step 3.81 G1 internal DNS includes Guacamole session host", () => {
  assert.ok(g1DnsPlan.hostnames.includes("session.sylion.internal"));
  assert.ok(g1DnsPlan.hostnames.includes("operator.sylion.internal"));
  assert.ok(g1DnsPlan.hostnames.includes("zangi.sylion.internal"));
  assert.equal(g1DnsPlan.dnsListenAddress, "10.42.0.11");
  assert.equal(g1DnsPlan.brokerAddress, "10.42.0.12");

  const config = renderDnsmasqConfig();
  assert.match(config, /listen-address=10\.42\.0\.11/);
  assert.match(config, /address=\/session\.sylion\.internal\/10\.42\.0\.12/);
  assert.match(config, /address=\/admin\.sylion\.internal\/10\.42\.0\.12/);
});

test("Step 3.81 G1 DNS installer is apply-gated and verifies dnsmasq", () => {
  const script = renderRemoteScript();
  assert.match(script, /dnsmasq --test/);
  assert.match(script, /systemctl restart dnsmasq/);
  assert.match(script, /session_lookup/);
  assert.equal(pkg.scripts["live:g1-internal-dns"], "node scripts/install-g1-internal-dns.mjs");
});
