import { createHash } from "node:crypto";
import { newId, requireCorrelationId } from "../../lib/id.js";

function stableJson(value) {
  return JSON.stringify(value, Object.keys(value).sort());
}

export class AuditService {
  constructor() {
    this.events = [];
    this.lastHash = null;
  }

  record(input) {
    const event = {
      id: newId("audit"),
      actorId: input.actorId || "system",
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId || null,
      tenantId: input.tenantId || null,
      operatorId: input.operatorId || null,
      timestamp: new Date().toISOString(),
      correlationId: requireCorrelationId(input.correlationId),
      idempotencyKey: input.idempotencyKey || null,
      previousValue: input.previousValue ?? null,
      newValue: input.newValue ?? null,
      policyDecision: input.policyDecision || "allow",
      approvalId: input.approvalId || null,
      result: input.result || "success",
      previousHash: this.lastHash
    };

    const hash = createHash("sha256")
      .update(stableJson(event))
      .digest("hex");

    const storedEvent = { ...event, hash };
    this.events.push(storedEvent);
    this.lastHash = hash;
    return storedEvent;
  }

  list() {
    return [...this.events];
  }
}

