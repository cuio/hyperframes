/**
 * Lightweight JSON-Schema-style validator for template propsSchemas.
 *
 * Built deliberately small: the planner already produces valid props through
 * the Anthropic tool contract; this is for the studio API's variant-pick PUT,
 * which accepts user-mutable input and shouldn't trust the body. A full ajv
 * dependency would be overkill — we validate top-level required fields, type
 * tags ("string"/"number"/"boolean"/"object"/"array"), and one level of array
 * item types. Nested objects and `oneOf`/`anyOf` are not enforced; the
 * subsequent assembler-level rendering catches structural mistakes that slip
 * through.
 *
 * Returns the list of issues; empty array = valid.
 */

export type ValidationIssue = string;

interface SchemaShape {
  type?: string;
  properties?: Record<string, unknown>;
  required?: unknown;
  items?: unknown;
}

function describeType(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function typeMatches(expected: string, value: unknown): boolean {
  const actual = describeType(value);
  if (expected === "integer") return actual === "number" && Number.isInteger(value);
  return actual === expected;
}

export function validateAgainstSchema(
  schema: Record<string, unknown> | null | undefined,
  value: unknown,
  pathPrefix = "props",
): ValidationIssue[] {
  if (!schema || typeof schema !== "object") return [];
  const s = schema as SchemaShape;
  const issues: ValidationIssue[] = [];

  if (typeof s.type === "string") {
    if (!typeMatches(s.type, value)) {
      issues.push(`${pathPrefix}: expected ${s.type}, got ${describeType(value)}`);
      return issues;
    }
  }

  if (s.type === "object" && value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(s.required)) {
      for (const key of s.required) {
        if (typeof key !== "string") continue;
        if (!Object.prototype.hasOwnProperty.call(obj, key)) {
          issues.push(`${pathPrefix}.${key}: required field missing`);
        }
      }
    }
    if (s.properties && typeof s.properties === "object") {
      for (const [key, propSchema] of Object.entries(s.properties)) {
        if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
        if (propSchema && typeof propSchema === "object") {
          issues.push(
            ...validateAgainstSchema(
              propSchema as Record<string, unknown>,
              obj[key],
              `${pathPrefix}.${key}`,
            ),
          );
        }
      }
    }
  }

  if (s.type === "array" && Array.isArray(value)) {
    if (s.items && typeof s.items === "object") {
      const itemSchema = s.items as Record<string, unknown>;
      for (let i = 0; i < value.length; i++) {
        issues.push(...validateAgainstSchema(itemSchema, value[i], `${pathPrefix}[${i}]`));
      }
    }
  }

  return issues;
}
