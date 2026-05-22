import assert from "node:assert/strict";
import test from "node:test";
import { publicPlan, renderGatewayConfig } from "../../../scripts/install-g2-workload-gateway.mjs";

test("Step 3.42 G2 workload gateway plan preserves thin-client security invariants", () => {
  const plan = publicPlan();

  assert.equal(plan.gateway.bindAddress, "10.42.0.12");
  assert.equal(plan.workload.bindAddress, "10.42.0.13");
  assert.equal(plan.invariants.privateBindOnly, true);
  assert.equal(plan.invariants.noTerminalOperationalData, true);
  assert.equal(plan.invariants.noG1G2Bypass, true);
  assert.equal(plan.invariants.cdrRequiredForFileTransfer, true);
  assert.equal(plan.invariants.noWorkloadSecretsInGeneratedConfig, true);
  assert.equal(plan.invariants.signalNativeNoVncUpstream, true);

  const signal = plan.apps.find((app) => app.key === "signal");
  assert.equal(signal.authMode, "none");
  assert.equal(signal.upstream, "http://10.42.0.13:3013");

  const zangi = plan.apps.find((app) => app.key === "zangi");
  assert.equal(zangi.productionGate, "android_native_runner_required");
});

test("Step 3.42 rendered gateway config has no embedded workload password and no public workload bind", () => {
  const config = renderGatewayConfig();

  assert.match(config, /listen 10\.42\.0\.12:443 ssl;/);
  assert.match(config, /server_name admin\.sylion\.internal;/);
  assert.match(config, /server_name operator\.sylion\.internal;/);
  assert.match(config, /location = \/ \{\n    return 302 \/operator;/);
  assert.doesNotMatch(config, /server_name admin\.sylion\.internal operator\.sylion\.internal/);
  assert.doesNotMatch(config, /listen 0\.0\.0\.0:443/);
  assert.doesNotMatch(config, /sylion-signal-local/);
  assert.doesNotMatch(config, /a2FzbV91c2VyOnN5bGlvbi1zaWduYWwtbG9jYWw=/);
  assert.match(config, /server_name signal\.sylion\.internal;[\s\S]+proxy_pass http:\/\/10\.42\.0\.13:3013;/);
  assert.doesNotMatch(config, /include \/etc\/nginx\/snippets\/sylion-signal-auth\.conf;/);
  assert.match(config, /X-Sylion-Terminal-Data-Stored "false"/);
  assert.match(config, /X-Sylion-G1-G2-Bypass "false"/);
  assert.match(config, /X-Sylion-CDR-Required "true"/);
  assert.match(config, /X-Sylion-Production-Gate "android_native_runner_required"/);
});
