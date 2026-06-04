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
  assert.equal(plan.invariants.noDeadNoVncRedirects, true);

  const signal = plan.apps.find((app) => app.key === "signal");
  assert.equal(signal.authMode, "root_only_nginx_include");
  assert.equal(signal.noVnc, false);
  assert.equal(signal.upstream, "https://10.42.0.13:3013");

  const duck = plan.apps.find((app) => app.key === "duckduckgo");
  assert.equal(duck.authMode, "root_only_nginx_include");
  assert.equal(duck.noVnc, false);
  assert.equal(duck.upstream, "http://10.42.0.13:3001");

  const zangi = plan.apps.find((app) => app.key === "zangi");
  assert.equal(zangi.noVnc, false);
  assert.equal(zangi.upstream, "http://10.42.0.13:3014");
  assert.equal(zangi.productionGate, "android_native_apk_provenance_required");

  const protonmail = plan.apps.find((app) => app.key === "protonmail");
  assert.equal(protonmail.authMode, "root_only_nginx_include");
  assert.equal(protonmail.noVnc, false);
  assert.equal(protonmail.upstream, "http://10.42.0.13:3016");
  assert.equal(protonmail.productionGate, "mail_account_human_test_required");

  const simplex = plan.apps.find((app) => app.key === "simplex");
  assert.equal(simplex.authMode, "root_only_nginx_include");
  assert.equal(simplex.noVnc, false);
  assert.equal(simplex.upstream, "http://10.42.0.13:3017");
  assert.equal(simplex.productionGate, "simplex_desktop_or_android_image_required");
});

test("Step 3.42 rendered gateway config has no embedded workload password and no public workload bind", () => {
  const config = renderGatewayConfig();

  assert.match(config, /listen 10\.42\.0\.12:443 ssl;/);
  assert.match(config, /ssl_certificate \/etc\/sylion\/tls\/sylion-internal-server-chain\.crt;/);
  assert.match(config, /ssl_certificate_key \/etc\/sylion\/tls\/sylion-internal-server\.key;/);
  assert.match(config, /server_name admin\.sylion\.internal;/);
  assert.match(config, /server_name operator\.sylion\.internal;/);
  assert.match(config, /location = \/ \{\n    return 302 \/operator;/);
  assert.doesNotMatch(config, /server_name admin\.sylion\.internal operator\.sylion\.internal/);
  assert.doesNotMatch(config, /listen 0\.0\.0\.0:443/);
  assert.doesNotMatch(config, /sylion-signal-local/);
  assert.doesNotMatch(config, /a2FzbV91c2VyOnN5bGlvbi1zaWduYWwtbG9jYWw=/);
  assert.doesNotMatch(config, /return 302 \/vnc\.html\?autoconnect=true&resize=remote&path=websockify;/);
  assert.doesNotMatch(config, /include \/etc\/nginx\/snippets\/sylion-signal-auth\.conf;/);
  assert.match(config, /server_name duckduckgo\.sylion\.internal;[\s\S]+include \/etc\/nginx\/snippets\/sylion-kasm-auth-duckduckgo\.conf;/);
  assert.match(config, /server_name signal\.sylion\.internal;[\s\S]+include \/etc\/nginx\/snippets\/sylion-kasm-auth-signal\.conf;/);
  assert.match(config, /server_name signal\.sylion\.internal;[\s\S]+proxy_ssl_verify off;[\s\S]+proxy_pass https:\/\/10\.42\.0\.13:3013;/);
  assert.match(config, /server_name duckduckgo\.sylion\.internal;[\s\S]+proxy_pass http:\/\/10\.42\.0\.13:3001;/);
  assert.match(config, /server_name zangi\.sylion\.internal;[\s\S]+proxy_pass http:\/\/10\.42\.0\.13:3014;/);
  assert.match(config, /server_name protonmail\.sylion\.internal;[\s\S]+include \/etc\/nginx\/snippets\/sylion-kasm-auth-protonmail\.conf;/);
  assert.match(config, /server_name protonmail\.sylion\.internal;[\s\S]+proxy_pass http:\/\/10\.42\.0\.13:3016;/);
  assert.match(config, /server_name simplex\.sylion\.internal;[\s\S]+include \/etc\/nginx\/snippets\/sylion-kasm-auth-simplex\.conf;/);
  assert.match(config, /server_name simplex\.sylion\.internal;[\s\S]+proxy_pass http:\/\/10\.42\.0\.13:3017;/);
  assert.match(config, /X-Sylion-Terminal-Data-Stored "false"/);
  assert.match(config, /X-Sylion-G1-G2-Bypass "false"/);
  assert.match(config, /X-Sylion-CDR-Required "true"/);
  assert.match(config, /X-Sylion-Production-Gate "android_native_apk_provenance_required"/);
  assert.match(config, /X-Sylion-Production-Gate "mail_account_human_test_required"/);
  assert.match(config, /X-Sylion-Production-Gate "simplex_desktop_or_android_image_required"/);
});
