import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "jsdom",
    // Some runtime tests drive jsdom rAF/animation/CSS-style introspection.
    // Under parallel load on a busy host they brush against the default 5s
    // ceiling — bump to 15s so under-load runs aren't false negatives. Tests
    // that are genuinely slow should still set their own per-test timeout.
    testTimeout: 15_000,
    coverage: {
      provider: "v8",
      include: ["src/runtime/**/*.ts"],
      exclude: [
        "src/runtime/**/*.test.ts",
        "src/runtime/types.ts",
        "src/runtime/window.d.ts",
        "src/runtime/entry.ts",
        "src/runtime/init.ts",
        "src/runtime/README.md",
      ],
      thresholds: {
        // Enforced in CI — these are floor values, not targets
        statements: 75,
        branches: 70,
        functions: 80,
        lines: 75,
      },
    },
  },
});
