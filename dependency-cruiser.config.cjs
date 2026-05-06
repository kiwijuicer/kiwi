"use strict";

module.exports = {
  forbidden: [
    {
      name: "no-app-imports-from-packages",
      severity: "error",
      comment: "Packages must not depend on app layer.",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
    {
      name: "core-stays-below-runtime-integrations",
      severity: "error",
      comment: "Core must stay planning/run-state only.",
      from: { path: "^packages/core/src/" },
      to: { path: "^packages/(adapters|sandbox|runtime|ops|a2a)/src/" },
    },
    {
      name: "contracts-no-internal-deps",
      severity: "error",
      comment: "Contracts must stay at the bottom of the dependency graph.",
      from: { path: "^packages/contracts/src/" },
      to: { path: "^packages/(core|adapters|sandbox|runtime|ops|a2a)/src/" },
    },
    {
      name: "a2a-no-runtime-or-ops-deps",
      severity: "error",
      comment: "A2A transport remains independent of execution and operator surfaces.",
      from: { path: "^packages/a2a/src/" },
      to: { path: "^packages/(runtime|ops|adapters|sandbox)/src/" },
    },
    {
      name: "runtime-no-ops-or-a2a-deps",
      severity: "error",
      comment: "Runtime owns execution and must not depend on presentation or A2A transport.",
      from: { path: "^packages/runtime/src/" },
      to: { path: "^packages/(ops|a2a)/src/" },
    },
    {
      name: "ops-no-a2a-or-sandbox-deps",
      severity: "error",
      comment: "Ops may compose core/runtime/adapters, but not A2A transport or sandbox internals.",
      from: { path: "^packages/ops/src/" },
      to: { path: "^packages/(a2a|sandbox)/src/" },
    },
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
    },
    exclude: {
      path: "(^|/)dist/|(^|/)node_modules/|\\.test\\.ts$|/__tests__/",
    },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
