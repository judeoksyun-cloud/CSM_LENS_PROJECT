import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_DASHBOARD_SNAPSHOT_PATH = resolve(
  MODULE_DIR,
  "..",
  "external-data",
  "csm-quarterly-dashboard-data.json",
);

export const RUNTIME_CONTRACT_VERSION = "csm-dashboard-runtime/v1";
export const OPENING_RECONCILIATION_REVIEW_THRESHOLD_BN = 20;

export async function readDashboardSnapshot(
  snapshotPath = DEFAULT_DASHBOARD_SNAPSHOT_PATH,
) {
  const raw = await readFile(snapshotPath, "utf8");
  const sourceData = JSON.parse(raw);
  const data = normalizeDashboardData(sourceData);
  const hash = createHash("sha256").update(raw).digest("hex");
  return { data, raw, hash, snapshotPath };
}

export function normalizeDashboardData(sourceData) {
  const analysisPolicy = sourceData.analysisPolicy ?? buildAnalysisPolicy(sourceData);
  const reviewItems = Array.isArray(sourceData.reviewItems) && sourceData.reviewItems.length
    ? sourceData.reviewItems
    : buildReviewItems(sourceData);

  return {
    ...sourceData,
    runtimeContractVersion: RUNTIME_CONTRACT_VERSION,
    canonicalDataContractVersion: sourceData.dataContractVersion ?? "unknown",
    analysisPolicy,
    reviewItems,
    reviewSummary: summarizeAllReviewItems(reviewItems),
  };
}

export function getSupportedCompanyKeys(snapshotData) {
  const policyCompanies = snapshotData.analysisPolicy?.supportedCompanies;
  if (Array.isArray(policyCompanies) && policyCompanies.length) {
    return policyCompanies.filter((companyKey) => snapshotData.sampleData?.[companyKey]);
  }
  return Object.keys(snapshotData.sampleData ?? {});
}

export function isQuarterPeriodKey(periodKey) {
  return /^(\d{4})-q([1-4])$/.test(String(periodKey));
}

export function parseQuarterPeriodKey(periodKey) {
  const match = String(periodKey).match(/^(\d{4})-q([1-4])$/);
  if (!match) return null;
  return { year: Number(match[1]), quarter: Number(match[2]) };
}

export function compareQuarterPeriodKeys(left, right) {
  const leftPeriod = parseQuarterPeriodKey(left);
  const rightPeriod = parseQuarterPeriodKey(right);
  if (!leftPeriod || !rightPeriod) return String(left).localeCompare(String(right));
  if (leftPeriod.year !== rightPeriod.year) return leftPeriod.year - rightPeriod.year;
  return leftPeriod.quarter - rightPeriod.quarter;
}

export function getLatestQuarterPeriodKey(snapshotData, companyKey) {
  const policyPeriod = snapshotData.analysisPolicy?.latestValidatedPeriodByCompany?.[companyKey];
  if (policyPeriod && snapshotData.sampleData?.[companyKey]?.periods?.[policyPeriod]) {
    return policyPeriod;
  }

  return Object.keys(snapshotData.sampleData?.[companyKey]?.periods ?? {})
    .filter(isQuarterPeriodKey)
    .sort(compareQuarterPeriodKeys)
    .at(-1);
}

export function getPreviousQuarterPeriodKey(periods, currentPeriodKey) {
  const ordered = Object.keys(periods ?? {})
    .filter(isQuarterPeriodKey)
    .sort(compareQuarterPeriodKeys);
  const currentIndex = ordered.indexOf(currentPeriodKey);
  return currentIndex > 0 ? ordered[currentIndex - 1] : null;
}

export function getQuarterPeriodLabel(periodKey) {
  const period = parseQuarterPeriodKey(periodKey);
  return period ? `${period.year} Q${period.quarter}` : String(periodKey);
}

export function buildQuarterPeriodScope(periodKey) {
  const period = parseQuarterPeriodKey(periodKey);
  if (!period) {
    return {
      mode: "latest-validated",
      label: String(periodKey),
      periodKey,
      periodLabel: String(periodKey),
    };
  }
  return {
    mode: "latest-validated",
    label: `${period.year}-${String(period.quarter * 3).padStart(2, "0")}`,
    periodKey,
    periodLabel: getQuarterPeriodLabel(periodKey),
  };
}

export function getFinancialMetric(snapshotData, companyKey, periodKey) {
  const period = snapshotData.sampleData?.[companyKey]?.periods?.[periodKey] ?? {};
  const legacy = snapshotData.financialMetrics?.[companyKey]?.[periodKey] ?? {};
  return {
    insuranceProfit: firstDefined(legacy.insuranceProfit, period.insuranceProfit),
    investmentProfit: firstDefined(legacy.investmentProfit, period.investmentProfit),
    netIncome: firstDefined(legacy.netIncome, period.parentNetIncome, period.netIncome),
    kics: firstDefined(legacy.kics, period.kics),
    sourceReferences: legacy.sourceReferences ?? {
      csm: period.sourceReference ?? null,
      insuranceProfit: period.sourceReference ?? null,
      netIncome: period.sourceReference ?? null,
      kics: period.sourceReference ?? null,
    },
  };
}

export function getReviewSummary(snapshotData, companyKey, periodKey) {
  const items = (snapshotData.reviewItems ?? []).filter(
    (item) => item.company === companyKey && item.period === periodKey,
  );
  const counts = countReviewItems(items);
  const status = counts.failed > 0
    ? "failed"
    : counts.needsReview > 0
      ? "needs_review"
      : "passed";
  return { status, items, ...counts };
}

function buildAnalysisPolicy(sourceData) {
  const supportedCompanies = Object.keys(sourceData.sampleData ?? {});
  return {
    aiResponseContractVersion: "csm-ai-layer/v1",
    canonicalDataContractVersion: sourceData.dataContractVersion ?? "unknown",
    supportedCompanies,
    latestValidatedPeriodByCompany: Object.fromEntries(
      supportedCompanies.map((companyKey) => [
        companyKey,
        Object.keys(sourceData.sampleData?.[companyKey]?.periods ?? {})
          .filter(isQuarterPeriodKey)
          .sort(compareQuarterPeriodKeys)
          .at(-1),
      ]),
    ),
    supportedAnalysisTypes: ["anomaly", "movement", "peer", "briefing", "chat"],
    forecastDisplayBasis: "latest-validated-only",
    sameOriginGateway: true,
  };
}

function buildReviewItems(sourceData) {
  const items = [];
  for (const [companyKey, company] of Object.entries(sourceData.sampleData ?? {})) {
    for (const [periodKey, period] of Object.entries(company.periods ?? {})) {
      if (!isQuarterPeriodKey(periodKey)) continue;
      items.push(buildMovementReviewItem(companyKey, company, periodKey, period));
      items.push(buildFinancialReviewItem(sourceData, companyKey, company, periodKey, period));
    }
  }
  return items;
}

function buildMovementReviewItem(companyKey, company, periodKey, period) {
  const movement = period.movement;
  const sourceReference = period.sourceReference ?? {};
  const hasMovement = movement && [
    "opening",
    "newbiz",
    "interest",
    "adjustment",
    "amortization",
    "closing",
  ].every((key) => Number.isFinite(movement[key]));
  const movementDifference = hasMovement
    ? movement.opening + movement.newbiz + movement.interest + movement.adjustment
      + movement.amortization - movement.closing
    : null;
  const sourceTraceComplete = Boolean(
    sourceReference.rceptNo
      && sourceReference.dartUrl
      && Array.isArray(sourceReference.sourceTables)
      && sourceReference.sourceTables.length,
  );
  const openingDifference = period.quarterlyAudit?.openingReconciliationDifference ?? 0;
  const needsOpeningReview = Math.abs(openingDifference)
    > OPENING_RECONCILIATION_REVIEW_THRESHOLD_BN;

  const failed = !hasMovement || movementDifference !== 0 || !sourceTraceComplete;
  const status = failed ? "failed" : needsOpeningReview ? "needs_review" : "passed";
  const reason = failed
    ? "Movement 산식 또는 원문 추적정보가 완전하지 않습니다."
    : needsOpeningReview
      ? `공시 기초 CSM과 직전 연말 잔액 차이가 ${openingDifference}십억원으로 검토 기준을 초과했습니다.`
      : "Movement 산식, 기초 잔액 대사, 원문 추적정보가 검증 기준을 통과했습니다.";

  return {
    id: `${companyKey}.${periodKey}.csm_movement`,
    company: companyKey,
    companyName: company.name ?? companyKey,
    period: periodKey,
    category: "csm",
    metric: "csm_movement",
    title: `${company.name ?? companyKey} ${periodKey} CSM Movement`,
    status,
    severity: failed ? "error" : needsOpeningReview ? "warning" : "info",
    systemValue: movement ?? null,
    basis: sourceReference.basis ?? period.metricBasis?.csm ?? "unknown",
    sourceReference,
    reviewReason: reason,
    recommendedAction: status === "passed"
      ? "정기 리뷰 시 원문 표 번호만 재확인합니다."
      : "원문 기초 잔액, 비교표 기준, 선택된 표 번호를 확인합니다.",
    validation: {
      movementDifference,
      openingReconciliationDifference: openingDifference,
      openingReviewThresholdBn: OPENING_RECONCILIATION_REVIEW_THRESHOLD_BN,
      sourceTraceComplete,
    },
  };
}

function buildFinancialReviewItem(sourceData, companyKey, company, periodKey, period) {
  const financial = getFinancialMetric(sourceData, companyKey, periodKey);
  const requiredMetrics = ["insuranceProfit", "netIncome", "kics"];
  const solvencyStatus = period.quarterlyAudit?.financialValidation?.solvencyStatus;
  const pendingMetrics = !Number.isFinite(financial.kics) && solvencyStatus === "pending_in_source"
    ? ["kics"]
    : [];
  const missingMetrics = requiredMetrics.filter(
    (key) => !Number.isFinite(financial[key]) && !pendingMetrics.includes(key),
  );
  const status = missingMetrics.length ? "failed" : pendingMetrics.length ? "needs_review" : "passed";

  return {
    id: `${companyKey}.${periodKey}.financial_metrics`,
    company: companyKey,
    companyName: company.name ?? companyKey,
    period: periodKey,
    category: "profit",
    metric: "financial_metrics",
    title: `${company.name ?? companyKey} ${periodKey} 손익/K-ICS`,
    status,
    severity: missingMetrics.length ? "error" : pendingMetrics.length ? "warning" : "info",
    systemValue: financial,
    basis: "period-level-dashboard-financial-metrics",
    sourceReference: period.sourceReference ?? {},
    reviewReason: missingMetrics.length
      ? `필수 재무지표가 누락되었습니다: ${missingMetrics.join(", ")}`
      : pendingMetrics.length
        ? `원문에서 아직 산출 중인 지표입니다: ${pendingMetrics.join(", ")}`
        : "보험손익, 당기순이익, K-ICS가 최신 분기 계약에 존재합니다.",
    recommendedAction: missingMetrics.length
      ? "DART/FISIS 원본과 분기 환산 결과를 확인합니다."
      : pendingMetrics.length
        ? "후속 공시에서 확정값이 게시되면 재수집하고 현재 공란은 유지합니다."
        : "보고 전 손익 기준과 FISIS 교차검증 메타데이터를 확인합니다.",
    validation: { missingMetrics, pendingMetrics, solvencyStatus },
  };
}

function countReviewItems(items) {
  return {
    total: items.length,
    passed: items.filter((item) => item.status === "passed").length,
    needsReview: items.filter((item) => item.status === "needs_review").length,
    failed: items.filter((item) => item.status === "failed").length,
  };
}

function summarizeAllReviewItems(items) {
  const counts = countReviewItems(items);
  return {
    total: counts.total,
    passed: counts.passed,
    needs_review: counts.needsReview,
    failed: counts.failed,
  };
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null) ?? null;
}
