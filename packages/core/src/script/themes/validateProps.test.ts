import { describe, it, expect } from "vitest";
import { validateAgainstSchema } from "./validateProps.js";

describe("validateAgainstSchema", () => {
  it("returns no issues for empty / undefined schema", () => {
    expect(validateAgainstSchema(null, { x: 1 })).toEqual([]);
    expect(validateAgainstSchema(undefined, { x: 1 })).toEqual([]);
    expect(validateAgainstSchema({}, { x: 1 })).toEqual([]);
  });

  it("flags top-level type mismatch", () => {
    const issues = validateAgainstSchema({ type: "object" }, "not-an-object");
    expect(issues).toEqual(["props: expected object, got string"]);
  });

  it("flags missing required fields", () => {
    const schema = {
      type: "object",
      required: ["title", "value"],
      properties: { title: { type: "string" }, value: { type: "number" } },
    };
    const issues = validateAgainstSchema(schema, { title: "ok" });
    expect(issues).toEqual(["props.value: required field missing"]);
  });

  it("flags nested type mismatch one level deep", () => {
    const schema = {
      type: "object",
      properties: {
        title: { type: "string" },
        value: { type: "number" },
      },
    };
    const issues = validateAgainstSchema(schema, { title: 5, value: "wrong" });
    expect(issues).toContain("props.title: expected string, got number");
    expect(issues).toContain("props.value: expected number, got string");
  });

  it("validates array item types", () => {
    const schema = {
      type: "array",
      items: { type: "string" },
    };
    const issues = validateAgainstSchema(schema, ["a", 2, "c"]);
    expect(issues).toEqual(["props[1]: expected string, got number"]);
  });

  it("treats integer as a number that is an integer", () => {
    const schema = { type: "integer" };
    expect(validateAgainstSchema(schema, 5)).toEqual([]);
    expect(validateAgainstSchema(schema, 5.5)).toEqual(["props: expected integer, got number"]);
  });

  it("returns no issues for a valid match", () => {
    const schema = {
      type: "object",
      required: ["title"],
      properties: {
        title: { type: "string" },
        items: { type: "array", items: { type: "string" } },
      },
    };
    const issues = validateAgainstSchema(schema, { title: "ok", items: ["a", "b"] });
    expect(issues).toEqual([]);
  });

  it("ignores unknown property keys (open schema)", () => {
    const schema = {
      type: "object",
      properties: { title: { type: "string" } },
    };
    const issues = validateAgainstSchema(schema, { title: "ok", extra: 99 });
    expect(issues).toEqual([]);
  });
});
