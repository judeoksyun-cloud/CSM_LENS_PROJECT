import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SNAPSHOT_PATH = resolve(
  MODULE_DIR,
  "..",
  "external-data",
  "csm-dashboard-agent-output.json",
);

const STAGE_DEFINITIONS = [
  { key: "dart_ingestion", label: "DART 수집" },
  { key: "csm_parsing", label: "CSM 파싱" },
  { key: "movement_mapping", label: "Movement 매핑" },
  { key: "validation", label: "검산" },
  { key: "human_review", label: "휴먼리뷰" },
];

export function createAgentRunGateway({
  snapshotPath = DEFAULT_SNAPSHOT_PATH,
  stageDelayMs = 700,
  now = () => Date.now(),
} = {}) {
  const runs = new Map();

  return {
    startRun: async ({ companyKey, periodKey } = {}) => {
      const snapshot = await readSnapshot(snapshotPath);
      const supportedCompanies = getSupportedCompanyKeys(snapshot);

      if (!supportedCompanies.includes(companyKey)) {
        throw new Error(`unsupported company: ${companyKey}`);
      }

      const company = snapshot.data.sampleData?.[companyKey];
      if (!company?.periods?.[periodKey]) {
        throw new Error(`unsupported period: ${companyKey}.${periodKey}`);
      }

      const reviewSummary = summarizeReviewState(
        snapshot.data.reviewItems ?? [],
        companyKey,
        periodKey,
      );
      const stageMessages = buildStageMessages(snapshot.data, companyKey, periodKey, reviewSummary);
      const createdAtMs = now();
      const runId = randomUUID();

      const run = {
        runId,
        createdAtMs,
        companyKey,
        periodKey,
        snapshotData: snapshot.data,
        snapshotHash: snapshot.hash,
        reviewSummary,
        validationFails: reviewSummary.failed > 0,
        stageMessages,
      };

      runs.set(runId, run);
      return serializeRun(run, now(), stageDelayMs);
    },
    getRun: async (runId) => {
      const run = runs.get(runId);
      if (!run) {
        throw new Error(`unknown run: ${runId}`);
      }

      return serializeRun(run, now(), stageDelayMs);
    },
  };
}

async function readSnapshot(snapshotPath) {
  const raw = await readFile(snapshotPath, "utf8");
  const data = JSON.parse(raw);
  const hash = createHash("sha256").update(raw).digest("hex");
  return { data, hash };
}

function getSupportedCompanyKeys(snapshot) {
  const policyCompanies = snapshot.data.analysisPolicy?.supportedCompanies;
  if (Array.isArray(policyCompanies) && policyCompanies.length) {
    return policyCompanies;
  }

  return Object.keys(snapshot.data.sampleData ?? {});
}

function summarizeReviewState(reviewItems, companyKey, periodKey) {
  const items = reviewItems.filter(
    (item) => item.company === companyKey && item.period === periodKey,
  );
  const counts = {
    total: items.length,
    passed: 0,
    needsReview: 0,
    failed: 0,
  };

  for (const item of items) {
    if (item.status === "passed") counts.passed += 1;
    if (item.status === "needs_review") counts.needsReview += 1;
    if (item.status === "failed") counts.failed += 1;
  }

  return { items, ...counts };
}

function buildStageMessages(snapshotData, companyKey, periodKey, reviewSummary) {
  const period = snapshotData.sampleData?.[companyKey]?.periods?.[periodKey];
  const sourceReference = period?.sourceReference ?? {};
  const movementItem =
    reviewSummary.items.find((item) => item.metric === "csm_movement") ??
    reviewSummary.items.find((item) => item.category === "csm") ??
    null;

  const sourceTableCount = Array.isArray(sourceReference.sourceTables)
    ? sourceReference.sourceTables.length
    : 0;
  const mappingNeedsReview = movementItem?.status === "needs_review";

  return {
    dart_ingestion:
      sourceReference.rceptNo != null
        ? `공시 원문 1건 확인 · 접수번호 ${sourceReference.rceptNo}`
        : "공시 원문 메타 확인",
    csm_parsing:
      sourceTableCount > 0
        ? `후보 표 ${sourceTableCount}개 탐지`
        : "CSM 후보 표 탐지",
    movement_mapping: mappingNeedsReview
      ? `조정 항목 1건 검토 필요`
      : "표준 Movement 항목으로 매핑 완료",
    validation:
      reviewSummary.failed > 0
        ? `검산 실패 ${reviewSummary.failed}건`
        : "기시·기말·합계 검산 통과",
    human_review:
      reviewSummary.needsReview > 0
        ? `검토 큐 ${reviewSummary.needsReview}건`
        : "검토 없음",
  };
}

function serializeRun(run, currentMs, stageDelayMs) {
  const stages = STAGE_DEFINITIONS.map((definition, index) =>
    serializeStage({
      definition,
      index,
      run,
      currentMs,
      stageDelayMs,
    }),
  );

  const validationIndex = STAGE_DEFINITIONS.findIndex(
    (definition) => definition.key === "validation",
  );
  const humanReviewIndex = STAGE_DEFINITIONS.findIndex(
    (definition) => definition.key === "human_review",
  );

  const validationEndMs = run.createdAtMs + stageDelayMs * (validationIndex + 1);
  const humanReviewEndMs = run.createdAtMs + stageDelayMs * (humanReviewIndex + 1);
  const validationComplete = currentMs >= validationEndMs;
  const runFailed = run.validationFails && validationComplete;
  const runCompleted = !runFailed && currentMs >= humanReviewEndMs;

  return {
    runId: run.runId,
    status: runFailed ? "failed" : runCompleted ? "completed" : "running",
    selectedCompany: run.companyKey,
    selectedPeriod: run.periodKey,
    stages,
    snapshot:
      validationComplete && !run.validationFails ? run.snapshotData : null,
    snapshotHash:
      validationComplete && !run.validationFails ? run.snapshotHash : null,
    updatedAt: new Date(currentMs).toISOString(),
    failureReason: runFailed
      ? `검산 단계에서 실패 ${run.reviewSummary.failed}건이 확인되어 마지막 검증 완료 스냅샷을 유지합니다.`
      : null,
  };
}

function serializeStage({ definition, index, run, currentMs, stageDelayMs }) {
  const stageStartMs = run.createdAtMs + index * stageDelayMs;
  const stageEndMs = stageStartMs + stageDelayMs;
  const validationIndex = STAGE_DEFINITIONS.findIndex(
    (stage) => stage.key === "validation",
  );
  const reviewIndex = STAGE_DEFINITIONS.findIndex(
    (stage) => stage.key === "human_review",
  );
  const validationFailed = run.validationFails && currentMs >= stageEndMs;

  let status = "idle";
  if (currentMs >= stageStartMs && currentMs < stageEndMs) {
    status = "running";
  } else if (currentMs >= stageEndMs) {
    status = "completed";
  }

  if (definition.key === "validation" && currentMs >= stageEndMs && run.validationFails) {
    status = "failed";
  }

  if (index > validationIndex && validationFailed) {
    status = "idle";
  }

  if (
    definition.key === "human_review" &&
    currentMs >= stageEndMs &&
    !run.validationFails
  ) {
    status = run.reviewSummary.needsReview > 0 ? "needs_review" : "not_required";
  }

  if (definition.key === "human_review" && validationFailed) {
    status = "idle";
  }

  return {
    key: definition.key,
    label: definition.label,
    status,
    message: run.stageMessages[definition.key] ?? "",
    startedAt: currentMs >= stageStartMs ? new Date(stageStartMs).toISOString() : null,
    finishedAt:
      currentMs >= stageEndMs && status !== "running" ? new Date(stageEndMs).toISOString() : null,
  };
}
