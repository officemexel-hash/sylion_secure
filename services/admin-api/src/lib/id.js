import { randomUUID } from "node:crypto";

export function newId(prefix) {
  return `${prefix}_${randomUUID()}`;
}

export function requireCorrelationId(value) {
  return value || newId("corr");
}
