// Object fields stay unknown until the caller validates their meaning.
export function fields(value: unknown): Record<string, unknown> {
  return Object(value) as Record<string, unknown>;
}
export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}
export function requiredFields(value: unknown): Record<string, unknown> {
  // Preserve direct property-access failures; the CLI masks these as before.
  if (value === null || value === undefined) throw new TypeError();
  return fields(value);
}
export function errorCode(error: unknown): unknown {
  return fields(error).code;
}
