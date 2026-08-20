import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_FORECAST_SNAPSHOT_PATH = resolve(
  MODULE_DIR,
  "..",
  "external-data",
  "csm-forecast-2026.json",
);

export const FORECAST_RUNTIME_CONTRACT_VERSION = "csm-forecast-runtime/v1";

export async function readForecastSnapshot(
  forecastPath = DEFAULT_FORECAST_SNAPSHOT_PATH,
) {
  const raw = await readFile(forecastPath, "utf8");
  const sourceData = JSON.parse(raw);
  const data = {
    ...sourceData,
    runtimeContractVersion: FORECAST_RUNTIME_CONTRACT_VERSION,
  };
  const hash = createHash("sha256").update(raw).digest("hex");
  return { data, raw, hash, forecastPath };
}

export function getCompanyForecast(forecastData, companyKey) {
  return forecastData?.forecasts?.[companyKey] ?? null;
}

export function validateForecastEntry(entry) {
  if (!entry) {
    return { status: "failed", reasons: ["회사 전망 계약이 없습니다."] };
  }

  const reasons = [];
  validateAnnualMovement(entry.base, "Base", reasons);
  validateAnnualMovement(entry.worst, "Worst", reasons);

  const modelClosing = entry.independentModel?.base?.closing;
  if (!Number.isFinite(modelClosing)) {
    reasons.push("독립 모델 전망값이 없습니다.");
  } else if (Number.isFinite(entry.base?.modelClosing) && entry.base.modelClosing !== modelClosing) {
    reasons.push("Base의 모델 종가와 독립 모델 종가가 일치하지 않습니다.");
  }

  return {
    status: reasons.length ? "failed" : "passed",
    reasons,
    sampleCount: entry.validation?.sampleCount ?? 0,
    validationLabel: entry.validation?.label ?? entry.confidence ?? "검증 제한",
  };
}

export function summarizeForecastEntry(entry) {
  if (!entry) return null;
  const validation = validateForecastEntry(entry);
  return {
    companyName: entry.companyName,
    asOfPeriod: entry.asOfPeriod,
    targetPeriod: entry.targetPeriod,
    independentModel: entry.independentModel?.base?.closing ?? entry.base?.modelClosing ?? null,
    base: entry.base?.closing ?? null,
    worst: entry.worst?.closing ?? null,
    targetAdjustmentOverlay: entry.base?.targetAdjustmentOverlay ?? 0,
    adjustmentBeforeTargetOverlay: entry.base?.adjustmentBeforeTargetOverlay ?? null,
    anchor: entry.anchor ?? null,
    horizon: entry.horizon ?? null,
    evidenceProfile: entry.evidenceProfile ?? null,
    validation: {
      ...(entry.validation ?? {}),
      contractStatus: validation.status,
      contractReasons: validation.reasons,
    },
  };
}

function validateAnnualMovement(movement, label, reasons) {
  const requiredKeys = [
    "opening",
    "newbiz",
    "interest",
    "adjustment",
    "amortization",
    "closing",
  ];
  if (!movement || requiredKeys.some((key) => !Number.isFinite(movement[key]))) {
    reasons.push(`${label} Movement 필수값이 완전하지 않습니다.`);
    return;
  }

  const economicClosing = movement.opening
    + movement.newbiz
    + movement.interest
    + movement.adjustment
    + movement.amortization;
  if (economicClosing !== movement.closing) {
    reasons.push(`${label} Movement 합계가 기말 CSM과 일치하지 않습니다.`);
  }
  if (Number.isFinite(movement.targetAdjustmentOverlay)) {
    if (
      !Number.isFinite(movement.adjustmentBeforeTargetOverlay)
      || movement.adjustmentBeforeTargetOverlay + movement.targetAdjustmentOverlay
        !== movement.adjustment
    ) {
      reasons.push(`${label} CSM 조정의 경영목표 연결 내역이 일치하지 않습니다.`);
    }
    if (
      Number.isFinite(movement.modelClosing)
      && movement.modelClosing + movement.targetAdjustmentOverlay !== movement.closing
    ) {
      reasons.push(`${label} 독립 모델과 경영목표 연결 조정의 합계가 기말 CSM과 일치하지 않습니다.`);
    }
  }
}
