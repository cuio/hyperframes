/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getVariables, readDeclaredDefaults } from "./getVariables";

const VARIABLES_ATTR = "data-composition-variables";

function setDeclared(json: string | null) {
  if (json == null) {
    document.documentElement.removeAttribute(VARIABLES_ATTR);
  } else {
    document.documentElement.setAttribute(VARIABLES_ATTR, json);
  }
}

function setOverrides(value: unknown) {
  (window as Window & { __hfVariables?: unknown }).__hfVariables = value;
}

describe("getVariables", () => {
  beforeEach(() => {
    setDeclared(null);
    setOverrides(undefined);
  });

  afterEach(() => {
    setDeclared(null);
    setOverrides(undefined);
  });

  it("returns {} when nothing is declared and no overrides", () => {
    expect(getVariables()).toEqual({});
  });

  it("returns declared defaults when no overrides", () => {
    setDeclared(
      JSON.stringify([
        { id: "title", type: "string", label: "Title", default: "Hello" },
        { id: "count", type: "number", label: "Count", default: 3 },
        { id: "active", type: "boolean", label: "Active", default: true },
      ]),
    );
    expect(getVariables()).toEqual({ title: "Hello", count: 3, active: true });
  });

  it("merges overrides over declared defaults (overrides win)", () => {
    setDeclared(
      JSON.stringify([
        { id: "title", type: "string", label: "Title", default: "Hello" },
        { id: "theme", type: "string", label: "Theme", default: "light" },
      ]),
    );
    setOverrides({ title: "Custom Title" });
    expect(getVariables()).toEqual({ title: "Custom Title", theme: "light" });
  });

  it("includes override keys not declared in the schema", () => {
    setDeclared(JSON.stringify([{ id: "title", type: "string", label: "Title", default: "x" }]));
    setOverrides({ extra: 42 });
    expect(getVariables()).toEqual({ title: "x", extra: 42 });
  });

  it("returns {} when the declared JSON is invalid", () => {
    setDeclared("{not-json");
    expect(getVariables()).toEqual({});
  });

  it("ignores declared entries without an id or default", () => {
    setDeclared(
      JSON.stringify([
        { id: "ok", type: "string", label: "Ok", default: "yes" },
        { type: "string", label: "no-id", default: "nope" },
        { id: "no-default", type: "string", label: "No default" },
        "not-an-object",
        null,
      ]),
    );
    expect(getVariables()).toEqual({ ok: "yes" });
  });

  it("ignores non-array declared payloads", () => {
    setDeclared(JSON.stringify({ title: "Hello" }));
    expect(getVariables()).toEqual({});
  });

  it("ignores non-object overrides (string, array, null)", () => {
    setDeclared(JSON.stringify([{ id: "title", type: "string", label: "Title", default: "x" }]));
    setOverrides("not-an-object");
    expect(getVariables()).toEqual({ title: "x" });
    setOverrides([1, 2, 3]);
    expect(getVariables()).toEqual({ title: "x" });
    setOverrides(null);
    expect(getVariables()).toEqual({ title: "x" });
  });

  it("supports the typed generic for editor ergonomics", () => {
    setDeclared(
      JSON.stringify([{ id: "title", type: "string", label: "Title", default: "Hello" }]),
    );
    type Vars = { title: string; missing?: number };
    const vars = getVariables<Vars>();
    expect(vars.title).toBe("Hello");
    expect(vars.missing).toBeUndefined();
  });
});

describe("readDeclaredDefaults", () => {
  it("returns {} for a null root", () => {
    expect(readDeclaredDefaults(null)).toEqual({});
  });

  it("extracts {id: default} from an arbitrary element with the attribute", () => {
    const el = document.createElement("html");
    el.setAttribute(
      "data-composition-variables",
      JSON.stringify([
        { id: "title", type: "string", label: "Title", default: "Hello" },
        { id: "count", type: "number", label: "Count", default: 3 },
      ]),
    );
    expect(readDeclaredDefaults(el)).toEqual({ title: "Hello", count: 3 });
  });

  it("returns {} when the attribute is invalid JSON or non-array", () => {
    const a = document.createElement("html");
    a.setAttribute("data-composition-variables", "{not json");
    expect(readDeclaredDefaults(a)).toEqual({});
    const b = document.createElement("html");
    b.setAttribute("data-composition-variables", JSON.stringify({ title: "x" }));
    expect(readDeclaredDefaults(b)).toEqual({});
  });
});
