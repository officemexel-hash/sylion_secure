import { AppError } from "../../lib/errors.js";

export class LocalSimulatorVerifier {
  constructor({ rpId = "localhost", origin = "http://localhost" } = {}) {
    this.mode = "local_simulator";
    this.rpId = rpId;
    this.origin = origin;
  }

  verifyAssertion({ challenge, credential, assertion = {} }) {
    const mode = assertion.mode || "local_simulator";
    if (mode !== "local_simulator") {
      throw new AppError(
        "unsupported_webauthn_mode",
        "WebAuthn verification mode is not enabled",
        422,
        {
          mode,
          enabledMode: this.mode,
          humanGateRequired: mode === "browser"
        }
      );
    }
    const expected = `simulated:${challenge.id}:${credential.id}`;
    if (assertion.signature !== expected) {
      throw new AppError("invalid_assertion", "Invalid WebAuthn assertion", 401, {
        reason: "invalid_signature",
        verificationMode: this.mode
      });
    }
    return {
      verificationMode: this.mode,
      signCounter: Number(assertion.signCounter || credential.signCounter + 1),
      origin: this.origin,
      rpId: this.rpId
    };
  }
}

export class BrowserWebAuthnVerifier {
  constructor({
    rpId = "localhost",
    origin = "http://localhost",
    attestationPolicy = "human_gate_required"
  } = {}) {
    this.mode = "browser";
    this.rpId = rpId;
    this.origin = origin;
    this.attestationPolicy = attestationPolicy;
  }

  verifyAssertion({ assertion = {} }) {
    if (assertion.mode !== "browser") {
      throw new AppError("unsupported_webauthn_mode", "Expected browser WebAuthn assertion", 422, {
        mode: assertion.mode || "missing",
        enabledMode: this.mode
      });
    }
    if (assertion.rpId && assertion.rpId !== this.rpId) {
      throw new AppError("invalid_webauthn_rp_id", "WebAuthn rpId is not accepted", 401, {
        expectedRpId: this.rpId
      });
    }
    if (assertion.origin && assertion.origin !== this.origin) {
      throw new AppError("invalid_webauthn_origin", "WebAuthn origin is not accepted", 401, {
        expectedOrigin: this.origin
      });
    }
    throw new AppError(
      "webauthn_human_gate_required",
      "Production WebAuthn verifier requires human-approved attestation policy",
      501,
      {
        verificationMode: this.mode,
        attestationPolicy: this.attestationPolicy,
        humanGateRequired: true
      }
    );
  }
}

export function createWebAuthnVerifier({
  mode = "local_simulator",
  rpId,
  origin,
  attestationPolicy
} = {}) {
  if (mode === "local_simulator") {
    return new LocalSimulatorVerifier({ rpId, origin });
  }
  if (mode === "browser") {
    return new BrowserWebAuthnVerifier({ rpId, origin, attestationPolicy });
  }
  throw new AppError("unsupported_webauthn_mode", "Unknown WebAuthn verifier mode", 422, { mode });
}
