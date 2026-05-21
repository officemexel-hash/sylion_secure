import { validationError } from "../../lib/errors.js";

export class OvhLiveAdapter {
  async createVpsSet() {
    throw validationError("OVH live adapter is not implemented for provider mutation", {
      providerKey: "ovh",
      blocker: "ovh_live_adapter_not_implemented",
      sideEffectAllowed: false
    });
  }
}
