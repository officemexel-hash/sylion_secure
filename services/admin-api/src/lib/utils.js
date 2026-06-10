import { validationError } from "./errors.js";

export function isoNow() {
  return new Date().toISOString();
}

export function requireText(value, field, min = 2) {
  if (!value || typeof value !== "string" || value.trim().length < min) {
    throw validationError(`${field} is required`, { field });
  }
  return value.trim();
}

export function normalizeLower(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

export function safeArray(value = [], field) {
  if (!Array.isArray(value)) {
    throw validationError(`${field} must be an array`, { field });
  }
  return value.map((item, index) => requireText(String(item), `${field}.${index}`, 1));
}
