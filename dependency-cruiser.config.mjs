export default {
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
      to: { path: "^packages/(adapters|sandbox|runtime|ops)/src/" },
    },
    {
      name: "contracts-no-internal-deps",
      severity: "error",
      comment: "Contracts must stay at the bottom of the dependency graph.",
      from: { path: "^packages/contracts/src/" },
      to: { path: "^packages/(core|adapters|sandbox|runtime|ops)/src/" },
    },
    {
      name: "runtime-no-ops-deps",
      severity: "error",
      comment: "Runtime owns execution and must not depend on presentation surfaces.",
      from: { path: "^packages/runtime/src/" },
      to: { path: "^packages/ops/src/" },
    },
    {
      name: "ops-no-sandbox-deps",
      severity: "error",
      comment: "Ops may compose core/runtime/adapters, but not sandbox internals.",
      from: { path: "^packages/ops/src/" },
      to: { path: "^packages/sandbox/src/" },
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
