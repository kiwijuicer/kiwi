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
      name: "core-does-not-import-adapters-or-sandbox",
      severity: "error",
      comment: "Core orchestrates through contracts only.",
      from: { path: "^packages/core/src/" },
      to: { path: "^packages/(adapters|sandbox)/src/" },
    },
    {
      name: "contracts-no-internal-deps",
      severity: "error",
      comment: "Contracts must stay at the bottom of the dependency graph.",
      from: { path: "^packages/contracts/src/" },
      to: { path: "^packages/(core|adapters|sandbox)/src/" },
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
