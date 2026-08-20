import { randomUUID } from "node:crypto";
import {
  compareQuarterPeriodKeys,
  DEFAULT_DASHBOARD_SNAPSHOT_PATH,
  getQuarterPeriodLabel,
  getReviewSummary,
  getSupportedCompanyKeys,
  isQuarterPeriodKey,
  readDashboardSnapshot,
} from "./dashboard-contract.mjs";
import {
  DEFAULT_FORECAST_SNAPSHOT_PATH,
  getCompanyForecast,
  readForecastSnapshot,
  summarizeForecastEntry,
  validateForecastEntry,
} from "./forecast-contract.mjs";

const STAGE_DEFINITIONS = [
  { key: "dart_ingestion", label: "DART 수집" },
  { key: "csm_parsing", label: "CSM 파싱" },
  { key: "movement_mapping", label: "Movement 매핑" },
  { key: "validation", label: "검산" },
  { key: "human_review", label: "휴먼리뷰" },
];

export function createAgentRunGateway({
  snapshotPath = DEFAULT_DASHBOARD_SNAPSHOT_PATH,
  forecastPath = DEFAULT_FORECAST_SNAPSHOT_PATH,
  stageDelayMs = 700,
  now = () => Date.now(),
} = {}) {
  const runs = new Map();

  return {
    listTargets: async ({ includeCompleted = false } = {}) => {
      const snapshot = await readDashboardSnapshot(snapshotPath);
      return buildRunTargetCatalog(snapshot.data, { includeCompleted });
    },
    startRun: async ({ companyKey, periodKey, allowRerun = false } = {}) => {
      const [snapshot, forecastSnapshot] = await Promise.all([
        readDashboardSnapshot(snapshotPath),
        readForecastSnapshot(forecastPath),
      ]);
      const supportedCompanies = getSupportedCompanyKeys(snapshot.data);
      const catalog = buildRunTargetCatalog(snapshot.data, { includeCompleted: true });
      const target = catalog.targets.find(
        (item) => item.companyKey === companyKey && item.periodKey === periodKey,
      );

      if (!supportedCompanies.includes(companyKey)) {
        throw new Error(`unsupported company: ${companyKey}`);
      }

      const company = snapshot.data.sampleData?.[companyKey];
      if (!company?.periods?.[periodKey] || !isQuarterPeriodKey(periodKey)) {
        throw new Error(`unsupported period: ${companyKey}.${periodKey}`);
      }

      if (target?.status === "completed" && !allowRerun) {
        throw new Error(`completed target already validated: ${companyKey}.${periodKey}`);
      }

      const reviewSummary = getReviewSummary(snapshot.data, companyKey, periodKey);
      const forecastEntry = getCompanyForecast(forecastSnapshot.data, companyKey);
      const forecastValidation = validateForecastEntry(forecastEntry);
      const stageMessages = buildStageMessages(
        snapshot.data,
        companyKey,
        periodKey,
        reviewSummary,
        forecastValidation,
      );
      const createdAtMs = now();
      const runId = randomUUID();

      const run = {
        runId,
        createdAtMs,
        companyKey,
        periodKey,
        snapshotData: snapshot.data,
        snapshotHash: snapshot.hash,
        forecastHash: forecastSnapshot.hash,
        forecastContractVersion: forecastSnapshot.data.version,
        forecastRuntimeContractVersion: forecastSnapshot.data.runtimeContractVersion,
        forecastSummary: summarizeForecastEntry(forecastEntry),
        forecastValidation,
        reviewSummary,
        validationFails: reviewSummary.failed > 0 || forecastValidation.status === "failed",
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

function buildRunTargetCatalog(snapshotData, { includeCompleted = false } = {}) {
  const targets = [];
  const summary = {
    backlog: 0,
    completed: 0,
    failed: 0,
    needs_review: 0,
  };

  for (const companyKey of getSupportedCompanyKeys(snapshotData)) {
    const company = snapshotData.sampleData?.[companyKey];
    if (!company) continue;

    const periodKeys = Object.keys(company.periods ?? {})
      .filter(isQuarterPeriodKey)
      .sort(comparePeriodKeysDesc);

    for (const periodKey of periodKeys) {
      const period = company.periods?.[periodKey];
      const reviewSummary = getReviewSummary(snapshotData, companyKey, periodKey);
      const status = getRunTargetStatus(reviewSummary);

      if (status === "completed") {
        summary.completed += 1;
      } else {
        summary.backlog += 1;
      }

      if (status === "failed") summary.failed += 1;
      if (status === "needs_review") summary.needs_review += 1;

      if (!includeCompleted && status === "completed") {
        continue;
      }

      targets.push({
        id: `${companyKey}.${periodKey}`,
        companyKey,
        companyName: company.name ?? companyKey,
        periodKey,
        periodLabel: getPeriodLabel(periodKey),
        status,
        reviewSummary,
        valueKind: period?.sourceReference?.valueKind ?? "unknown",
      });
    }
  }

  targets.sort(compareRunTargets);
  return { targets, summary };
}

function getRunTargetStatus(reviewSummary) {
  if (reviewSummary.failed > 0) return "failed";
  if (reviewSummary.needsReview > 0) return "needs_review";
  return "completed";
}

function compareRunTargets(targetA, targetB) {
  const statusRank = {
    failed: 0,
    needs_review: 1,
    completed: 2,
  };
  const rankA = statusRank[targetA.status] ?? 9;
  const rankB = statusRank[targetB.status] ?? 9;

  if (rankA !== rankB) {
    return rankA - rankB;
  }

  const periodCompare = comparePeriodKeysDesc(targetA.periodKey, targetB.periodKey);
  if (periodCompare !== 0) {
    return periodCompare;
  }

  return targetA.companyName.localeCompare(targetB.companyName, "ko");
}

function comparePeriodKeysDesc(periodAKey, periodBKey) {
  return compareQuarterPeriodKeys(periodBKey, periodAKey);
}

function getPeriodLabel(periodKey) {
  return getQuarterPeriodLabel(periodKey);
}

function buildStageMessages(
  snapshotData,
  companyKey,
  periodKey,
  reviewSummary,
  forecastValidation,
) {
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
      reviewSummary.failed > 0 || forecastValidation.status === "failed"
        ? `검산 실패 ${reviewSummary.failed + forecastValidation.reasons.length}건`
        : "분기 Movement와 전망 계약 합계 검산 통과",
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
    forecast:
      validationComplete && !run.validationFails ? run.forecastSummary : null,
    forecastHash:
      validationComplete && !run.validationFails ? run.forecastHash : null,
    forecastContractVersion: run.forecastContractVersion,
    forecastRuntimeContractVersion: run.forecastRuntimeContractVersion,
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
