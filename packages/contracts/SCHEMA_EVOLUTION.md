# Schema Evolution Rules

For project setup phases (Steps 01-14), backward compatibility is not required.

Rules:

- Prefer clear breaking changes over compatibility aliases during Steps 01-14.
- Keep schema names and terminology aligned with `docs/vision.md`.
- Remove or rename fields directly when it improves clarity.
- Introduce a formal BC policy only after explicit milestone decision.

Implementation anchors:

- `ContractsSchemaVersionSchema`
- `ContractsSchemaEvolutionModeSchema`
- `ContractsMetadataSchema`
