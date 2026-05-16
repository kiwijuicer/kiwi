import { loadEvidenceManifest, writeEvidenceManifest, writeRunAuditSnapshot } from "./evidence";
import { renderOperatorSnapshotHtml, writeOperatorSnapshot } from "./operator-surface";
import { publishPrDraft } from "./pr-draft";
import { RunExplanationBuilder, RunSummaryBuilder } from "./run-summary";

export class EvidenceService {
  constructor(
    private readonly deps: {
      writeRunAuditSnapshot: typeof writeRunAuditSnapshot;
      writeEvidenceManifest: typeof writeEvidenceManifest;
      loadEvidenceManifest: typeof loadEvidenceManifest;
    } = {
      writeRunAuditSnapshot,
      writeEvidenceManifest,
      loadEvidenceManifest,
    },
  ) {}

  writeRunAuditSnapshot(params: Parameters<typeof writeRunAuditSnapshot>[0]): ReturnType<typeof writeRunAuditSnapshot> {
    return this.deps.writeRunAuditSnapshot(params);
  }

  writeEvidenceManifest(params: Parameters<typeof writeEvidenceManifest>[0]): ReturnType<typeof writeEvidenceManifest> {
    return this.deps.writeEvidenceManifest(params);
  }

  loadEvidenceManifest(params: Parameters<typeof loadEvidenceManifest>[0]): ReturnType<typeof loadEvidenceManifest> {
    return this.deps.loadEvidenceManifest(params);
  }
}

export class OperatorSurfaceService {
  constructor(
    private readonly deps: {
      renderOperatorSnapshotHtml: typeof renderOperatorSnapshotHtml;
      writeOperatorSnapshot: typeof writeOperatorSnapshot;
    } = {
      renderOperatorSnapshotHtml,
      writeOperatorSnapshot,
    },
  ) {}

  renderSnapshotHtml(
    params: Parameters<typeof renderOperatorSnapshotHtml>[0],
  ): ReturnType<typeof renderOperatorSnapshotHtml> {
    return this.deps.renderOperatorSnapshotHtml(params);
  }

  writeSnapshot(params: Parameters<typeof writeOperatorSnapshot>[0]): ReturnType<typeof writeOperatorSnapshot> {
    return this.deps.writeOperatorSnapshot(params);
  }
}

export class PrDraftPublisher {
  constructor(
    private readonly deps: {
      publishPrDraft: typeof publishPrDraft;
    } = {
      publishPrDraft,
    },
  ) {}

  publish(params: Parameters<typeof publishPrDraft>[0]): ReturnType<typeof publishPrDraft> {
    return this.deps.publishPrDraft(params);
  }
}

export interface OpsServices {
  evidence: EvidenceService;
  operatorSurface: OperatorSurfaceService;
  prDrafts: PrDraftPublisher;
  runSummaries: RunSummaryBuilder;
  runExplanations: RunExplanationBuilder;
}

export function createOpsServices(): OpsServices {
  return {
    evidence: new EvidenceService(),
    operatorSurface: new OperatorSurfaceService(),
    prDrafts: new PrDraftPublisher(),
    runSummaries: new RunSummaryBuilder(),
    runExplanations: new RunExplanationBuilder(),
  };
}
