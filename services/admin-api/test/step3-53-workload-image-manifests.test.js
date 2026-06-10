import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { AdminApiClient } from "../src/sdk/adminApiClient.js";

async function startTestServer() {
  const app = createApp();
  const server = await app.listen(0);
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function loginClient(baseUrl) {
  const anon = new AdminApiClient({
    baseUrl,
    correlationIdFactory: () => `corr_step3_53_${crypto.randomUUID()}`
  });
  const credentialId = `cred-step3-53-${crypto.randomUUID()}`;
  const enrollment = await anon.createEnrollmentOptions({
    email: "admin@sylion.local",
    password: "ChangeMe-LocalOnly-1!"
  });
  await anon.verifyEnrollment({
    challengeId: enrollment.challenge.id,
    credential: { id: credentialId, publicKey: `simulated-public-key:${credentialId}` }
  });
  const loginOptions = await anon.createWebAuthnLoginOptions({
    email: "admin@sylion.local",
    password: "ChangeMe-LocalOnly-1!"
  });
  const session = await anon.verifyWebAuthnLogin({
    challengeId: loginOptions.challenge.id,
    credentialId,
    assertion: {
      signature: `simulated:${loginOptions.challenge.id}:${credentialId}`,
      signCounter: 1
    }
  });
  return anon.withToken(session.token);
}

async function registerLabHost(client) {
  return client.registerWorkloadNativeHost({
    hostId: "WORKLOAD_NATIVE_LAB_01",
    serverNumber: "2983993",
    productId: "AX102-U",
    region: "hel1",
    publicIpv4: "65.109.123.72",
    publicIpv6: "2a01:4f9:3051:1729::2",
    orderId: "dedicated_order_example",
    providerResourceId: "B20260522-3442319-3016298",
    lifecycleState: "lab_qualified",
    tenancyMode: "shared_pool",
    evidence: {
      bootstrap: {
        kvmDevice: "present",
        virtualizationFlags: 32,
        firecrackerBinary: "/opt/sylion/bin/firecracker",
        jailerBinary: "/opt/sylion/bin/jailer"
      },
      firecrackerInstall: {
        firecrackerVersion: "Firecracker v1.15.1",
        jailerVersion: "Jailer v1.15.1"
      },
      firecrackerSmoke: {
        microvmStarted: true,
        state: "Running"
      },
      hardware: {
        kvmDevice: "present",
        amdVirtualizationFlags: 32,
        apparmor: "active",
        auditd: "active"
      },
      containerRuntime: {
        dockerActive: "active",
        containerdActive: "active"
      }
    },
    productionBlockers: [
      "tenant_isolation_not_validated",
      "g1_g2_private_path_not_bound",
      "thin_stream_broker_not_bound"
    ]
  });
}

function signalManifest(overrides = {}) {
  return {
    hostId: "WORKLOAD_NATIVE_LAB_01",
    appKey: "signal",
    appName: "Signal",
    runtimeKind: "firecracker_microvm",
    imageRef: "image://sylion/signal-firecracker-lab-v0",
    kernelRef: "artifact://workload-native-lab-01/firecracker/vmlinux.bin",
    rootfsRef: "artifact://workload-native-lab-01/apps/signal/rootfs.ext4",
    packageRef: "package://signal-desktop/pending-approved-download",
    cdrPolicyRef: "cdr://mandatory-workload-file-transfer",
    streamGateway: {
      bindAddress: "127.0.0.1",
      sourcePort: 7901,
      throughG2: true,
      pixelOptimized: true,
      publicExposureAllowed: false
    },
    launchManifest: {
      networkMode: "tap_isolated_g2_private_only",
      storageMode: "ephemeral_cdr_only"
    },
    buildEvidence: {
      reproducibleBuild: false,
      cdrHookDeclared: true
    },
    productionBlockers: [
      "g1_g2_private_path_not_bound",
      "g2_stream_broker_not_bound",
      "pixel_human_regression_pending",
      "hsm_pki_not_integrated",
      "app_image_build_not_reproducible_yet"
    ],
    ...overrides
  };
}

test("Step 3.53 registers a CDR-gated Signal Firecracker manifest without production execution", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    await registerLabHost(client);

    const result = await client.createWorkloadImageManifest(signalManifest());

    assert.equal(result.manifest.appKey, "signal");
    assert.equal(result.manifest.runtimeKind, "firecracker_microvm");
    assert.equal(result.manifest.readyForLabLaunch, true);
    assert.equal(result.manifest.productionExecutionAllowed, false);
    assert.equal(result.manifest.secretsReleaseAllowed, false);
    assert.equal(result.manifest.terminalDataStored, false);
    assert.equal(result.manifest.cdrPolicyRef, "cdr://mandatory-workload-file-transfer");
    assert.ok(
      result.manifest.checks.every(
        (check) => check.requiredForLab === false || check.status === "passed"
      )
    );

    const listed = await client.listWorkloadImageManifests();
    assert.equal(listed.manifests.length, 1);
    assert.equal(listed.manifests[0].hostId, "WORKLOAD_NATIVE_LAB_01");
  } finally {
    await close();
  }
});

test("Step 3.53 blocks public stream bindings and sensitive build evidence", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    await registerLabHost(client);

    const publicStream = await client.createWorkloadImageManifest(
      signalManifest({
        streamGateway: {
          bindAddress: "0.0.0.0",
          sourcePort: 7901,
          throughG2: true,
          pixelOptimized: true,
          publicExposureAllowed: true
        }
      })
    );
    assert.equal(publicStream.manifest.readyForLabLaunch, false);
    assert.equal(
      publicStream.manifest.checks.find((check) => check.key === "private_stream_binding").status,
      "blocked"
    );

    await assert.rejects(
      () =>
        client.createWorkloadImageManifest(
          signalManifest({
            buildEvidence: { accidentalToken: "api_key_should_never_be_here" }
          })
        ),
      /sensitive runtime data/
    );
  } finally {
    await close();
  }
});

test("Step 3.53 requires Android-native evidence for Zangi", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    await registerLabHost(client);

    const blocked = await client.createWorkloadImageManifest(
      signalManifest({
        appKey: "zangi",
        appName: "Zangi",
        imageRef: "image://sylion/zangi-firecracker-lab-v0",
        rootfsRef: "artifact://workload-native-lab-01/apps/zangi/rootfs.ext4",
        packageRef: "package://zangi/android-apk/pending-approved-download"
      })
    );
    assert.equal(blocked.manifest.readyForLabLaunch, false);
    assert.equal(
      blocked.manifest.checks.find((check) => check.key === "zangi_android_runtime").status,
      "blocked"
    );

    const androidReady = await client.createWorkloadImageManifest(
      signalManifest({
        appKey: "zangi",
        appName: "Zangi",
        runtimeKind: "android_native_workload",
        imageRef: "image://sylion/zangi-android-native-lab-v0",
        kernelRef: null,
        rootfsRef: null,
        packageRef: "package://zangi/android-apk/pending-approved-download",
        buildEvidence: {
          binderfs: true,
          androidRuntime: true,
          cdrHookDeclared: true
        }
      })
    );
    assert.equal(androidReady.manifest.readyForLabLaunch, true);
  } finally {
    await close();
  }
});
