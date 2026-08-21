# -*- coding: utf-8 -*-
"""Build explainable annual five-year CSM forecasts for the nine-company dashboard."""

from __future__ import annotations

import json
import statistics
from copy import deepcopy
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "external-data" / "csm-quarterly-dashboard-data.json"
OUTPUT_JSON = ROOT / "external-data" / "csm-forecast-2026.json"
OUTPUT_JS = ROOT / "csm-prototype" / "forecast-data.generated.js"

LOOKBACK_WEIGHTS = [0.10, 0.20, 0.30, 0.40]
BACKTEST_YEARS = (2024, 2025)
BACKTEST_ORIGIN_QUARTERS = (1, 2, 3)
HISTORY_YEARS = 3
ANALYST_OVERLAY_WEIGHT = 0.25
DOWNSIDE_QUANTILE = 0.80
NEWBIZ_STRESS_BOUNDS = (0.10, 0.35)
ADJUSTMENT_DOWNSIDE_RATE_BOUNDS = (0.01, 0.08)
WORST_NEWBIZ_DISCOUNT = 0.10
WORST_ADJUSTMENT_STRESS = 0.10
WORST_ADJUSTMENT_RATE_POINT_FLOOR = 0.01
ANNUAL_ADJUSTMENT_WEIGHTS = (0.35, 0.65)
THREE_YEAR_TREND_WEIGHTS = (0.20, 0.30, 0.50)
NEWBIZ_GROWTH_WEIGHTS = (0.35, 0.65)
NEWBIZ_GROWTH_BOUNDS = (-0.05, 0.05)
OPTIMISM_BIAS_WEIGHT = 0.25
OPTIMISM_BIAS_CAP = 0.02
CALCULATION_YEARS = range(2026, 2031)
DISPLAY_YEARS = tuple(CALCULATION_YEARS)
TARGET_OVERLAY_NORMALIZATION_YEARS = 3
FORECAST_YEAR = 2026
AS_OF_QUARTER = 2
AS_OF_PERIOD = f"{FORECAST_YEAR}-q{AS_OF_QUARTER}"
ACTUAL_QUARTERS = tuple(range(1, AS_OF_QUARTER + 1))
FORECAST_QUARTERS = tuple(range(AS_OF_QUARTER + 1, 5))

GENERAL_SOURCES = [
    {
        "title": "KB증권 보험업 전망 (2026.06.22)",
        "url": "https://rdata.kbsec.com/pdf_data/20260622111726153K.pdf",
        "type": "sell_side",
        "use": "업계 CSM 성장 둔화 가능성과 잔존 경험조정 위험을 장기 낙관 편향 통제의 방향성 근거로만 사용",
    },
    {
        "title": "삼성증권 보험업 이슈 브리프 (2026.01.05)",
        "url": "https://www.samsungpop.com/common.do?cmd=down&contentType=application%2Fpdf&fileName=2020%2F2026010509115239K_02_03.pdf&inlineYn=Y&saveKey=research.pdf",
        "type": "sell_side",
        "use": "업종 방향성 참고용이며 회사별 수치 오버레이에는 사용하지 않음",
    },
]

SAMSUNG_LIFE_DRIVER_SOURCES = [
    {
        "id": "samsung-2026-management-target",
        "title": "삼성생명 2026년말 CSM 목표 13.5조원",
        "url": None,
        "type": "user_provided",
        "verificationStatus": "unverified",
        "use": "담당자가 별도 기입한 목표를 경영계획 Base에 적용",
    },
    {
        "id": "samsung-2026-q2-dart",
        "title": "삼성생명 2026년 반기보고서",
        "url": "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260814003263",
        "type": "official_filing",
        "use": "2026년 상반기 CSM과 누적 CSM Movement 실제값의 원문 기준점",
    },
    {
        "id": "samsung-2026-q1-call",
        "title": "Samsung Life 1Q 2026 earnings call transcript",
        "url": "https://www.alphaspread.com/security/krx/032830/investor-relations/earnings-call/q1-2026",
        "type": "earnings_call",
        "use": "건강보험 중심 판매, FC 증가, 초기 해지율 상승 후 안정화에 대한 경영진 설명",
    },
    {
        "id": "kb-samsung-2026-02-19",
        "title": "KB증권 삼성생명 기업분석 (2026.02.19)",
        "url": "https://rdata.kbsec.com/pdf_data/20260219103715460E.pdf",
        "type": "sell_side",
        "use": "2025년 분기 APE와 신계약 CSM 수익성 지표의 과거 비교 기준",
    },
    {
        "id": "csm-forecast-methodology",
        "title": "CSM 전망 산출 방법론",
        "url": "../CSM_FORECAST_METHODOLOGY.md",
        "type": "methodology",
        "use": "계절성·런레이트 결합, 이자·상각 산식과 조정 브리지의 계산 기준",
    },
]

CONFIG = {
    "samsung-life": {
        "known_base_anchor": {
            "value": 13500,
            "label": "2026년말 CSM 목표",
            "sourceType": "user_provided",
            "source": "사용자 제공",
            "receivedAt": "2026-08-16",
            "verificationStatus": "unverified",
            "verificationLabel": "담당자 별도 기입",
            "originalAttached": False,
        },
        "base_newbiz": 2400,
        "base_adjustment": -900,
        "confidence": "중상",
        "base_newbiz_reason": "1분기 신계약 CSM 0.85조원과 최근 분기 계절성을 반영해 잔여 3개 분기 2.40조원으로 설정.",
        "base_adjustment_reason": "최근 회사별 조정 추이와 증권사 보험업 전망을 함께 반영해 잔여 조정을 -0.90조원으로 설정.",
        "sources": [],
    },
    "hanwha-life": {
        "base_newbiz": 1750,
        "base_adjustment": -850,
        "confidence": "중상",
        "base_newbiz_reason": "1분기 신계약 CSM 0.61조원과 종신보험 배수 개선을 반영해 잔여 신계약 1.75조원으로 설정.",
        "base_adjustment_reason": "회사가 밝힌 조정 감소와 연간 CSM 순증 가능성을 반영하되 2분기 가정 점검 불확실성을 남겨 -0.85조원 적용.",
        "sources": [
            {"title": "한화생명 1Q26 증권사 리포트", "url": "https://file.alphasquare.co.kr/media/pdfs/company-report/_260513%20%ED%95%9C%ED%99%94%EC%83%9D%EB%AA%85_%EC%A0%84%EB%B0%B0%EC%8A%B9_908_Online%20report%20_%206_10p_%ED%95%9C%ED%99%94%EC%83%9D%EB%AA%85.pdf", "type": "sell_side", "use": "CSM 배수 상승과 신계약 CSM 0.61조원을 Base에 반영"},
        ],
    },
    "kyobo-life": {
        "base_newbiz": 1150,
        "base_adjustment": -450,
        "interest_rate_override": 0.007,
        "confidence": "중",
        "base_newbiz_reason": "1분기 고효율 보장성 중심 신계약 증가와 하반기 모멘텀 유지 방침을 반영해 잔여 신계약 1.15조원 설정.",
        "base_adjustment_reason": "과거 이자/조정 항목 간 재분류 변동을 제거한 정상화 기준으로 잔여 조정 -0.45조원 적용.",
        "sources": [],
    },
    "shinhan-life": {
        "base_newbiz": 1220,
        "base_adjustment": -550,
        "confidence": "중",
        "base_newbiz_reason": "2025년 신계약 CSM 1.6조원과 내실 중심 전략을 반영해 잔여 신계약 1.22조원 설정.",
        "base_adjustment_reason": "보유 CSM 성장세는 유지하되 수익성 회복 불확실성을 반영해 잔여 조정 -0.55조원 적용.",
        "sources": [],
    },
    "samsung-fire": {
        "base_newbiz": 2150,
        "base_adjustment": -850,
        "confidence": "중",
        "base_newbiz_reason": "1분기 신계약 CSM과 최근 분기 계절성을 반영해 잔여 신계약을 전년 수준보다 낮은 2.15조원으로 설정.",
        "base_adjustment_reason": "우량계약 전략과 업권 공통 손해율 가정 부담을 상쇄해 잔여 조정 -0.85조원 적용.",
        "sources": [],
    },
    "meritz-fire": {
        "base_newbiz": 1350,
        "base_adjustment": -450,
        "confidence": "중상",
        "base_newbiz_reason": "1분기 신계약 CSM 0.44조원과 전년 대비 23.4% 성장을 반영하되 업권 수익성 정상화를 고려해 잔여 1.35조원 설정.",
        "base_adjustment_reason": "최근 조정 안정성과 손해율 가정 정상화 위험을 함께 반영해 잔여 조정 -0.45조원 적용.",
        "sources": [],
    },
    "db-insurance": {
        "base_newbiz": 2200,
        "base_adjustment": -1200,
        "confidence": "중",
        "base_newbiz_reason": "1분기 보장성 신계약 매출과 신계약 CSM 감소세를 반영해 잔여 신계약 2.20조원으로 낮춰 설정.",
        "base_adjustment_reason": "최근 연말 대규모 조정 이력과 1분기 정상화를 함께 반영해 잔여 조정 -1.20조원 적용.",
        "sources": [{"title": "DB손해보험 1Q26 증권사 리포트", "url": "https://file.alphasquare.co.kr/media/pdfs/company-report/_260518%20DB%EC%86%90%ED%95%B4%EB%B3%B4%ED%97%98_%EC%A0%84%EB%B0%B0%EC%8A%B9_912_Online%20report%20_%206_10p_DB%EC%86%90%ED%95%B4%EB%B3%B4%ED%97%98.pdf", "type": "sell_side", "use": "보장성 매출과 신계약 CSM 감소 전망을 25% 애널리스트 오버레이에 반영"}],
    },
    "hyundai-marine": {
        "base_newbiz": 1550,
        "base_adjustment": -800,
        "confidence": "중",
        "base_newbiz_reason": "분기 0.5조원 안팎의 견조한 신계약 흐름을 반영해 잔여 신계약 1.55조원 설정.",
        "base_adjustment_reason": "예실차 개선과 장기보험 손익 회복을 반영하되 연말 가정변경을 고려해 -0.80조원 적용.",
        "sources": [{"title": "KB증권 현대해상 1Q26 리포트", "url": "https://rdata.kbsec.com/pdf_data/20260515082529577K.pdf", "type": "sell_side", "use": "예실차 개선과 연간 장기 위험손해율 전망을 Base 조정에 반영"}],
    },
    "kb-insurance": {
        "base_newbiz": 1350,
        "base_adjustment": -500,
        "confidence": "중하",
        "base_newbiz_reason": "최근 분기 신계약 CSM과 2025년 분기 계절성을 적용해 잔여 신계약 1.35조원 설정. 동일 CSM 기준의 증권사 목표값은 미확인.",
        "base_adjustment_reason": "최근 회사별 조정 추이를 기준으로 잔여 조정 -0.50조원 적용하며 별도 외부 보정은 하지 않음.",
        "sources": [],
    },
}


def period_sort_key(period_key: str) -> tuple[int, int]:
    year, quarter = period_key.split("-q")
    return int(year), int(quarter)


def trailing_quarter_keys(periods: dict, as_of_period: str, count: int = 4) -> list[str]:
    keys = sorted(
        (
            key
            for key in periods
            if "-q" in key and period_sort_key(key) <= period_sort_key(as_of_period)
        ),
        key=period_sort_key,
    )
    return keys[-count:]


def weighted_rate(periods: dict, key: str, as_of_period: str = AS_OF_PERIOD) -> float:
    period_keys = trailing_quarter_keys(periods, as_of_period)
    weights = list(range(1, len(period_keys) + 1))
    total_weight = sum(weights)
    values = []
    for period_key, weight in zip(period_keys, weights):
        movement = periods[period_key]["movement"]
        exposure = movement["opening"] + movement["newbiz"]
        numerator = movement[key] if key == "interest" else -movement[key]
        values.append((weight / total_weight) * numerator / exposure)
    return sum(values)


def available_history_years(periods: dict, forecast_year: int) -> list[int]:
    years = []
    for year in range(forecast_year - HISTORY_YEARS, forecast_year):
        if all(f"{year}-q{quarter}" in periods for quarter in (1, 2, 3, 4)):
            years.append(year)
    return years


def prior_annual_adjustment_observations(
    periods: dict,
    forecast_year: int,
    lookback: int = 2,
) -> list[dict]:
    """Return only full-year observations available before the forecast year."""
    observations = []
    for year in range(forecast_year - lookback, forecast_year):
        period = periods.get(f"{year}-ye")
        movement = period.get("movement") if period else None
        if not movement or not movement.get("opening"):
            continue
        observations.append(
            {
                "year": year,
                "opening": movement["opening"],
                "adjustment": movement["adjustment"],
                "rate": movement["adjustment"] / movement["opening"],
            }
        )
    return observations


def normalized_annual_adjustment_target(periods: dict, forecast_year: int) -> dict:
    """Estimate recurring adjustment without repeating positive one-off reversals."""
    observations = prior_annual_adjustment_observations(periods, forecast_year)
    if not observations:
        raw_rate = 0.0
        weights = []
    else:
        raw_weights = ANNUAL_ADJUSTMENT_WEIGHTS[-len(observations):]
        weight_total = sum(raw_weights)
        weights = [weight / weight_total for weight in raw_weights]
        raw_rate = sum(
            item["rate"] * weight
            for item, weight in zip(observations, weights)
        )
    normalized_rate = min(raw_rate, 0.0)
    opening_period = periods.get(f"{forecast_year}-q1") or periods[f"{forecast_year - 1}-ye"]
    opening = opening_period["movement"]["opening"]
    return {
        "method": "prior full-year adjustment rate, 35/65 recency weighted, positive recurring rate capped at 0%",
        "opening": opening,
        "rawRate": raw_rate,
        "normalizedRate": normalized_rate,
        "positiveRateCapApplied": raw_rate > 0,
        "annualTarget": round(opening * normalized_rate),
        "observations": [
            {**item, "weight": round(weight, 6)}
            for item, weight in zip(observations, weights)
        ],
    }


def estimate_model_inputs(periods: dict, forecast_year: int) -> dict:
    inputs = estimate_backtest_inputs(periods, forecast_year, AS_OF_QUARTER)
    drivers = inputs["drivers"]
    return {
        **{key: inputs[key] for key in (
            "remainingNewbiz", "remainingAdjustment", "newbizShares",
            "adjustmentShares", "interestRate", "amortizationRate",
        )},
        "drivers": {
            "newbiz": {
                "ytdGrowth": drivers["ytdNewbizGrowth"],
                "priorRemainingGrowth": drivers["priorRemainingGrowth"],
                "appliedGrowthSignal": drivers["appliedGrowthSignal"],
                "futureQuarters": drivers["futureQuarters"],
            },
            "adjustment": {
                "method": drivers["adjustmentMethod"],
                "rawAnnualRate": drivers["adjustmentRawAnnualRate"],
                "normalizedAnnualRate": drivers["adjustmentNormalizedAnnualRate"],
                "positiveRateCapApplied": drivers["adjustmentPositiveRateCapApplied"],
                "annualTarget": drivers["annualAdjustmentTarget"],
                "actualYtd": drivers["actualYtdAdjustment"],
                "observations": drivers["adjustmentObservations"],
            },
            "originQuarter": AS_OF_QUARTER,
            "futureQuarters": drivers["futureQuarters"],
            "rateLookbackPeriods": drivers["rateLookbackPeriods"],
        },
    }


def project(opening: int, newbiz_total: int, adjustment_total: int, newbiz_shares: list[float], adjustment_shares: list[float], interest_rate: float, amortization_rate: float) -> dict:
    current = opening
    totals = {"newbiz": 0, "interest": 0, "adjustment": 0, "amortization": 0}
    quarters = []
    for index, quarter in enumerate(FORECAST_QUARTERS):
        newbiz = round(newbiz_total * newbiz_shares[index])
        adjustment = round(adjustment_total * adjustment_shares[index])
        if index == len(FORECAST_QUARTERS) - 1:
            newbiz = newbiz_total - totals["newbiz"]
            adjustment = adjustment_total - totals["adjustment"]
        exposure = current + newbiz
        interest = round(interest_rate * exposure)
        amortization = -round(amortization_rate * exposure)
        closing = current + newbiz + interest + adjustment + amortization
        quarter_values = {
            "period": f"2026-q{quarter}", "opening": current, "newbiz": newbiz,
            "interest": interest, "adjustment": adjustment,
            "amortization": amortization, "closing": closing,
        }
        quarters.append(quarter_values)
        for key in totals:
            totals[key] += quarter_values[key]
        current = closing
    return {"opening": opening, **totals, "closing": current, "quarters": quarters}


def annualize(actual_movements: list[dict], remaining: dict) -> dict:
    """Combine disclosed YTD actuals and the remaining forecast into annual Movement."""
    actual_totals = {
        key: sum(item[key] for item in actual_movements)
        for key in ("newbiz", "interest", "adjustment", "amortization")
    }
    annual = {
        "opening": actual_movements[0]["opening"],
        **{key: actual_totals[key] + remaining[key] for key in actual_totals},
        "closing": remaining["closing"],
        "quarters": [*actual_movements, *remaining["quarters"]],
        "remainingForecast": remaining,
        "movementBasis": "2025년말 기시 · 2026.1Q~2Q 실적 + 2026.3Q~4Q 전망",
    }
    return annual


def reconcile_annual_to_anchor(annual: dict, target_closing: int) -> int:
    """Include the management-target gap in CSM adjustment while preserving its audit trail."""
    delta = target_closing - annual["closing"]
    annual["modelClosing"] = annual["closing"]
    annual["adjustmentBeforeTargetOverlay"] = annual["adjustment"]
    annual["targetAdjustmentOverlay"] = delta
    annual["adjustment"] += delta
    annual["closing"] = target_closing
    annual["adjustmentOverlayBasis"] = "경영목표와 독립 모델 차이를 경영목표 연결 조정으로 분리"

    quarters = annual.get("quarters") or []
    if quarters:
        last_quarter = quarters[-1]
        last_quarter["adjustmentBeforeTargetOverlay"] = last_quarter["adjustment"]
        last_quarter["targetAdjustmentOverlay"] = delta
        last_quarter["adjustment"] += delta
        last_quarter["closing"] = target_closing

    remaining = annual.get("remainingForecast")
    if remaining:
        remaining["adjustmentBeforeTargetOverlay"] = remaining["adjustment"]
        remaining["targetAdjustmentOverlay"] = delta
        remaining["adjustment"] += delta
        remaining["closing"] = target_closing
        remaining_quarters = remaining.get("quarters") or []
        if remaining_quarters and (not quarters or remaining_quarters[-1] is not quarters[-1]):
            remaining_last = remaining_quarters[-1]
            remaining_last["adjustmentBeforeTargetOverlay"] = remaining_last["adjustment"]
            remaining_last["targetAdjustmentOverlay"] = delta
            remaining_last["adjustment"] += delta
            remaining_last["closing"] = target_closing
    return delta


def clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def deteriorate_adjustment(base_adjustment: int, opening: int, downside_rate: float) -> int:
    """Apply a backtest-calibrated absolute downside relative to opening CSM."""
    return base_adjustment - round(opening * downside_rate)


def stress_adjustment_against_base(
    base_adjustment: int,
    opening: int,
    stress_rate: float = WORST_ADJUSTMENT_STRESS,
) -> int:
    """Make adjustment uniformly worse, with a floor when Base is near zero/positive."""
    proportional_stress = round(abs(base_adjustment) * stress_rate)
    rate_point_floor = round(abs(opening) * WORST_ADJUSTMENT_RATE_POINT_FLOOR)
    return base_adjustment - max(proportional_stress, rate_point_floor)


def simple_worst_inputs(base_newbiz: int, base_adjustment: int, opening: int) -> tuple[int, int]:
    return (
        round(base_newbiz * (1 - WORST_NEWBIZ_DISCOUNT)),
        stress_adjustment_against_base(base_adjustment, opening),
    )


def conservative_percentile(values: list[float], quantile: float) -> float:
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, int(len(ordered) * quantile + 0.999999) - 1))
    return ordered[index]


def remaining_seasonal_shares(periods: dict, forecast_year: int, origin_quarter: int, key: str) -> list[float]:
    future_quarters = tuple(range(origin_quarter + 1, 5))
    yearly_shares = []
    for year in available_history_years(periods, forecast_year):
        values = [abs(periods[f"{year}-q{quarter}"]["movement"][key]) for quarter in future_quarters]
        total = sum(values)
        if total:
            yearly_shares.append([value / total for value in values])
    if not yearly_shares:
        return [1 / len(future_quarters)] * len(future_quarters)
    shares = [statistics.mean(year[index] for year in yearly_shares) for index in range(len(future_quarters))]
    total = sum(shares)
    return [share / total for share in shares]


def estimate_backtest_inputs(periods: dict, forecast_year: int, origin_quarter: int) -> dict:
    future_quarters = tuple(range(origin_quarter + 1, 5))
    prior_year = forecast_year - 1
    earlier_year = forecast_year - 2
    prior_remaining_newbiz = sum(
        periods[f"{prior_year}-q{quarter}"]["movement"]["newbiz"] for quarter in future_quarters
    )
    current_ytd_newbiz = sum(
        periods[f"{forecast_year}-q{quarter}"]["movement"]["newbiz"]
        for quarter in range(1, origin_quarter + 1)
    )
    prior_ytd_newbiz = sum(
        periods[f"{prior_year}-q{quarter}"]["movement"]["newbiz"]
        for quarter in range(1, origin_quarter + 1)
    )
    ytd_growth = current_ytd_newbiz / prior_ytd_newbiz - 1 if prior_ytd_newbiz else 0
    earlier_keys = [f"{earlier_year}-q{quarter}" for quarter in future_quarters]
    earlier_remaining_newbiz = (
        sum(periods[key]["movement"]["newbiz"] for key in earlier_keys)
        if all(key in periods for key in earlier_keys)
        else None
    )
    prior_growth = (
        prior_remaining_newbiz / earlier_remaining_newbiz - 1
        if earlier_remaining_newbiz
        else 0
    )
    applied_growth = clamp((ytd_growth * 0.65 + prior_growth * 0.35) * 0.5, -0.20, 0.20)
    remaining_newbiz = round(prior_remaining_newbiz * (1 + applied_growth))

    adjustment_target = normalized_annual_adjustment_target(periods, forecast_year)
    actual_ytd_adjustment = sum(
        periods[f"{forecast_year}-q{quarter}"]["movement"]["adjustment"]
        for quarter in range(1, origin_quarter + 1)
    )
    as_of_period = f"{forecast_year}-q{origin_quarter}"
    return {
        "remainingNewbiz": remaining_newbiz,
        "remainingAdjustment": adjustment_target["annualTarget"] - actual_ytd_adjustment,
        "newbizShares": remaining_seasonal_shares(periods, forecast_year, origin_quarter, "newbiz"),
        "adjustmentShares": remaining_seasonal_shares(periods, forecast_year, origin_quarter, "adjustment"),
        "interestRate": weighted_rate(periods, "interest", as_of_period),
        "amortizationRate": weighted_rate(periods, "amortization", as_of_period),
        "drivers": {
            "originQuarter": origin_quarter,
            "futureQuarters": list(future_quarters),
            "ytdNewbizGrowth": round(ytd_growth, 6),
            "priorRemainingGrowth": round(prior_growth, 6),
            "appliedGrowthSignal": round(applied_growth, 6),
            "adjustmentMethod": adjustment_target["method"],
            "adjustmentRawAnnualRate": round(adjustment_target["rawRate"], 6),
            "adjustmentNormalizedAnnualRate": round(adjustment_target["normalizedRate"], 6),
            "adjustmentPositiveRateCapApplied": adjustment_target["positiveRateCapApplied"],
            "annualAdjustmentTarget": adjustment_target["annualTarget"],
            "actualYtdAdjustment": actual_ytd_adjustment,
            "adjustmentObservations": adjustment_target["observations"],
            "rateLookbackPeriods": trailing_quarter_keys(periods, as_of_period),
        },
    }


def project_remaining_year(opening: int, forecast_year: int, origin_quarter: int, inputs: dict) -> dict:
    current = opening
    totals = {"newbiz": 0, "interest": 0, "adjustment": 0, "amortization": 0}
    quarters = []
    future_quarters = tuple(range(origin_quarter + 1, 5))
    for index, quarter in enumerate(future_quarters):
        newbiz = round(inputs["remainingNewbiz"] * inputs["newbizShares"][index])
        adjustment = round(inputs["remainingAdjustment"] * inputs["adjustmentShares"][index])
        if index == len(future_quarters) - 1:
            newbiz = inputs["remainingNewbiz"] - totals["newbiz"]
            adjustment = inputs["remainingAdjustment"] - totals["adjustment"]
        exposure = current + newbiz
        interest = round(inputs["interestRate"] * exposure)
        amortization = -round(inputs["amortizationRate"] * exposure)
        closing = current + newbiz + interest + adjustment + amortization
        quarter_values = {
            "period": f"{forecast_year}-q{quarter}",
            "opening": current,
            "newbiz": newbiz,
            "interest": interest,
            "adjustment": adjustment,
            "amortization": amortization,
            "closing": closing,
        }
        quarters.append(quarter_values)
        for key in totals:
            totals[key] += quarter_values[key]
        current = closing
    return {"opening": opening, **totals, "closing": current, "quarters": quarters}


def run_backtest(periods: dict, forecast_year: int, origin_quarter: int) -> dict:
    inputs = estimate_backtest_inputs(periods, forecast_year, origin_quarter)
    origin = periods[f"{forecast_year}-q{origin_quarter}"]
    remaining = project_remaining_year(origin["csm"], forecast_year, origin_quarter, inputs)
    actual = periods[f"{forecast_year}-ye"]
    future_quarters = tuple(range(origin_quarter + 1, 5))
    actual_remaining_newbiz = sum(
        periods[f"{forecast_year}-q{quarter}"]["movement"]["newbiz"]
        for quarter in future_quarters
    )
    actual_remaining_adjustment = sum(
        periods[f"{forecast_year}-q{quarter}"]["movement"]["adjustment"]
        for quarter in future_quarters
    )
    closing_error = remaining["closing"] - actual["csm"]
    return {
        "forecastYear": forecast_year,
        "originQuarter": origin_quarter,
        "asOfPeriod": f"{forecast_year}-q{origin_quarter}",
        "targetPeriod": f"{forecast_year}-ye",
        "predictedClosing": remaining["closing"],
        "actualClosing": actual["csm"],
        "closingError": closing_error,
        "closingAbsolutePercentageError": round(abs(closing_error) / actual["csm"], 6),
        "predictedRemainingNewbiz": inputs["remainingNewbiz"],
        "actualRemainingNewbiz": actual_remaining_newbiz,
        "newbizAbsolutePercentageError": round(
            abs(inputs["remainingNewbiz"] - actual_remaining_newbiz)
            / max(abs(actual_remaining_newbiz), 1),
            6,
        ),
        "predictedRemainingAdjustment": inputs["remainingAdjustment"],
        "actualRemainingAdjustment": actual_remaining_adjustment,
        "adjustmentAbsoluteErrorToOpening": round(
            abs(inputs["remainingAdjustment"] - actual_remaining_adjustment) / origin["csm"],
            6,
        ),
        "inputAudit": {
            "rateLookbackPeriods": inputs["drivers"]["rateLookbackPeriods"],
            "originQuarter": origin_quarter,
            "adjustmentMethod": inputs["drivers"]["adjustmentMethod"],
            "adjustmentNormalizedAnnualRate": inputs["drivers"]["adjustmentNormalizedAnnualRate"],
            "adjustmentObservations": inputs["drivers"]["adjustmentObservations"],
        },
    }


def validation_label(sample_count: int, mape: float) -> str:
    if sample_count < 8:
        return "검증 제한"
    if mape <= 0.04:
        return "검증 보통"
    return "오차 주의"


def calibration_from_samples(samples: list[dict]) -> dict:
    return {
        "quantile": DOWNSIDE_QUANTILE,
        "sampleCount": len(samples),
        "newbizStress": round(clamp(conservative_percentile(
            [sample["newbizAbsolutePercentageError"] for sample in samples],
            DOWNSIDE_QUANTILE,
        ), *NEWBIZ_STRESS_BOUNDS), 6),
        "adjustmentDownsideRateToOpening": round(clamp(conservative_percentile(
            [sample["adjustmentAbsoluteErrorToOpening"] for sample in samples],
            DOWNSIDE_QUANTILE,
        ), *ADJUSTMENT_DOWNSIDE_RATE_BOUNDS), 6),
        "closingErrorP80": round(conservative_percentile(
            [sample["closingAbsolutePercentageError"] for sample in samples],
            DOWNSIDE_QUANTILE,
        ), 6),
    }


def blend_calibration(company: dict, sector: dict) -> dict:
    return {
        "quantile": DOWNSIDE_QUANTILE,
        "sampleCount": company["sampleCount"],
        "sectorSampleCount": sector["sampleCount"],
        "method": "백테스트 검증 참고값(현재 Worst 산식에는 미사용)",
        "newbizStress": round((company["newbizStress"] + sector["newbizStress"]) / 2, 6),
        "adjustmentDownsideRateToOpening": round((
            company["adjustmentDownsideRateToOpening"]
            + sector["adjustmentDownsideRateToOpening"]
        ) / 2, 6),
        "closingErrorP80": round((company["closingErrorP80"] + sector["closingErrorP80"]) / 2, 6),
    }


def build_backtest_registry(source: dict) -> dict:
    by_company = {}
    sector_samples = {}
    all_samples = []
    for company_key, company in source.items():
        samples = [
            run_backtest(company["periods"], year, quarter)
            for year in BACKTEST_YEARS
            for quarter in BACKTEST_ORIGIN_QUARTERS
        ]
        mape = statistics.mean(sample["closingAbsolutePercentageError"] for sample in samples)
        bias = statistics.mean(sample["closingError"] for sample in samples)
        mae = statistics.mean(abs(sample["closingError"]) for sample in samples)
        company_calibration = calibration_from_samples(samples)
        by_company[company_key] = {
            "sampleCount": len(samples),
            "meanAbsolutePercentageError": round(mape, 6),
            "meanAbsoluteErrorBn": round(mae),
            "meanErrorBn": round(bias),
            "validationLabel": validation_label(len(samples), mape),
            "calibration": company_calibration,
            "samples": samples,
        }
        tagged_samples = [{"companyKey": company_key, "sector": company["sector"], **sample} for sample in samples]
        all_samples.extend(tagged_samples)
        sector_samples.setdefault(company["sector"], []).extend(tagged_samples)
    by_sector = {
        sector: calibration_from_samples(samples)
        for sector, samples in sector_samples.items()
    }
    calibration = calibration_from_samples(all_samples)
    return {
        "method": "rolling-origin Q1/Q2/Q3-to-year-end hindcast",
        "years": list(BACKTEST_YEARS),
        "originQuarters": list(BACKTEST_ORIGIN_QUARTERS),
        "global": calibration,
        "bySector": by_sector,
        "byCompany": by_company,
    }


def newbiz_growth_policy(
    periods: dict,
    forecast_newbiz: int,
    opening: int,
    company_backtest: dict,
) -> dict:
    """Use 2024/2025 actuals and the current-year Base forecast for the trend."""
    observations = [
        {"year": 2024, "value": periods["2024-ye"]["movement"]["newbiz"], "valueKind": "actual"},
        {"year": 2025, "value": periods["2025-ye"]["movement"]["newbiz"], "valueKind": "actual"},
        {"year": FORECAST_YEAR, "value": forecast_newbiz, "valueKind": "base_forecast"},
    ]
    growth_observations = []
    for index in range(1, len(observations)):
        previous = observations[index - 1]
        current = observations[index]
        growth_observations.append(
            {
                "fromYear": previous["year"],
                "toYear": current["year"],
                "rate": current["value"] / previous["value"] - 1,
                "weight": NEWBIZ_GROWTH_WEIGHTS[index - 1],
            }
        )
    raw_growth = sum(item["rate"] * item["weight"] for item in growth_observations)
    bounded_growth = clamp(raw_growth, *NEWBIZ_GROWTH_BOUNDS)
    optimism_bias_penalty = clamp(
        max(company_backtest.get("meanErrorBn", 0), 0)
        / max(opening, 1)
        * OPTIMISM_BIAS_WEIGHT,
        0,
        OPTIMISM_BIAS_CAP,
    )
    applied_growth = clamp(
        bounded_growth - optimism_bias_penalty,
        *NEWBIZ_GROWTH_BOUNDS,
    )
    return {
        "rawGrowth": raw_growth,
        "boundedGrowth": bounded_growth,
        "optimismBiasPenalty": optimism_bias_penalty,
        "appliedGrowth": applied_growth,
        "backtestMeanErrorBn": company_backtest.get("meanErrorBn", 0),
        "observations": observations,
        "growthObservations": growth_observations,
    }


def csm_adjustment_rate_policy(periods: dict, base: dict) -> dict:
    """Blend 2024/2025 actuals and 2026 Base while excluding non-recurring items."""
    observations = []
    for year in (2024, 2025):
        movement = periods[f"{year}-ye"]["movement"]
        adjustment = movement["adjustment"]
        one_off_excluded = adjustment if adjustment > 0 else 0
        recurring_adjustment = adjustment - one_off_excluded
        observations.append(
            {
                "year": year,
                "valueKind": "actual",
                "opening": movement["opening"],
                "reportedAdjustment": adjustment,
                "oneOffExcluded": one_off_excluded,
                "recurringAdjustment": recurring_adjustment,
                "rate": recurring_adjustment / movement["opening"],
                "included": not bool(one_off_excluded),
                "treatment": (
                    "연간 순양(+) 조정은 비경상 환입으로 보아 장기 반복에서 제외"
                    if one_off_excluded
                    else "연간 순액 사용 · 분기 내 환입·재분류는 별도 반복하지 않음"
                ),
            }
        )

    forecast_recurring_adjustment = base.get("adjustmentBeforeTargetOverlay", base["adjustment"])
    target_overlay = base.get("targetAdjustmentOverlay", 0)
    forecast_one_off = target_overlay + max(forecast_recurring_adjustment, 0)
    forecast_recurring_adjustment = min(forecast_recurring_adjustment, 0)
    observations.append(
        {
            "year": FORECAST_YEAR,
            "valueKind": "base_forecast",
            "opening": base["opening"],
            "reportedAdjustment": base["adjustment"],
            "oneOffExcluded": forecast_one_off,
            "recurringAdjustment": forecast_recurring_adjustment,
            "rate": forecast_recurring_adjustment / base["opening"],
            "included": forecast_recurring_adjustment < 0,
            "treatment": "경영목표 연결분과 순양(+) 전망분 제외 · 상반기 일회성 조정은 연간 정상화 전망에서 반복하지 않음",
        }
    )

    included_weight_total = sum(
        weight
        for item, weight in zip(observations, THREE_YEAR_TREND_WEIGHTS)
        if item["included"]
    )
    effective_weights = [
        weight / included_weight_total if item["included"] and included_weight_total else 0.0
        for item, weight in zip(observations, THREE_YEAR_TREND_WEIGHTS)
    ]
    weighted_rate = sum(
        item["rate"] * weight
        for item, weight in zip(observations, effective_weights)
    )
    return {
        "method": "2024 actual 20% + 2025 actual 30% + 2026 Base forecast 50%, one-off adjustments excluded",
        "rate": min(weighted_rate, 0.0),
        "rawRate": weighted_rate,
        "weights": effective_weights,
        "observations": [
            {
                **item,
                "nominalWeight": THREE_YEAR_TREND_WEIGHTS[index],
                "weight": effective_weights[index],
            }
            for index, item in enumerate(observations)
        ],
        "oneOffPolicy": "연간 순양(+) 조정, 경영목표 연결분과 분기성 환입·재분류의 총액 반복을 제외",
    }


def project_full_year(opening: int, newbiz_total: int, adjustment_total: int, interest_rate: float, amortization_rate: float) -> dict:
    current = opening
    totals = {"newbiz": 0, "interest": 0, "adjustment": 0, "amortization": 0}
    for index in range(4):
        newbiz = round(newbiz_total / 4) if index < 3 else newbiz_total - totals["newbiz"]
        adjustment = round(adjustment_total / 4) if index < 3 else adjustment_total - totals["adjustment"]
        exposure = current + newbiz
        interest = round(interest_rate * exposure)
        amortization = -round(amortization_rate * exposure)
        current = current + newbiz + interest + adjustment + amortization
        for key, value in (("newbiz", newbiz), ("interest", interest), ("adjustment", adjustment), ("amortization", amortization)):
            totals[key] += value
    return {"opening": opening, **totals, "closing": current}


def annual_point(year: int, projection: dict) -> dict:
    point = {
        "period": f"{year}-ye",
        **{key: projection[key] for key in ("opening", "newbiz", "interest", "adjustment", "amortization", "closing")},
    }
    if "targetAdjustmentOverlay" in projection:
        point["targetAdjustmentOverlay"] = projection["targetAdjustmentOverlay"]
        point["adjustmentBeforeTargetOverlay"] = projection.get("adjustmentBeforeTargetOverlay")
        point["modelClosing"] = projection.get("modelClosing")
    return point


def annualized_growth(start: int, end: int, years: int) -> float:
    if start <= 0 or end <= 0 or years <= 0:
        return 0
    return (end / start) ** (1 / years) - 1


def build_horizon(
    periods: dict,
    base: dict,
    worst: dict,
    interest_rate: float,
    amortization_rate: float,
    calibration: dict,
    company_backtest: dict,
) -> dict:
    growth_policy = newbiz_growth_policy(periods, base["newbiz"], base["opening"], company_backtest)
    adjustment_policy = csm_adjustment_rate_policy(periods, base)
    growth = growth_policy["appliedGrowth"]
    base_adjustment_rate = adjustment_policy["rate"]
    target_adjustment_overlay = base.get("targetAdjustmentOverlay", 0)
    target_overlay_schedule = {2026: target_adjustment_overlay}
    calculated_base = {2026: annual_point(2026, base)}
    calculated_worst = {2026: annual_point(2026, worst)}
    base_opening = base["closing"]
    worst_opening = worst["closing"]
    base_newbiz = base["newbiz"]

    for year in tuple(CALCULATION_YEARS)[1:]:
        base_newbiz = round(base_newbiz * (1 + growth))
        recurring_base_adjustment = round(base_opening * base_adjustment_rate)
        normalization_step = max(0, TARGET_OVERLAY_NORMALIZATION_YEARS - (year - 2026))
        annual_target_overlay = round(
            target_adjustment_overlay * normalization_step / TARGET_OVERLAY_NORMALIZATION_YEARS
        )
        target_overlay_schedule[year] = annual_target_overlay
        base_adjustment = recurring_base_adjustment + annual_target_overlay
        base_projection = project_full_year(base_opening, base_newbiz, base_adjustment, interest_rate, amortization_rate)
        if target_adjustment_overlay:
            base_projection.update(
                {
                    "targetAdjustmentOverlay": annual_target_overlay,
                    "adjustmentBeforeTargetOverlay": recurring_base_adjustment,
                    "modelClosing": base_projection["closing"] - annual_target_overlay,
                }
            )
        worst_projection = project_full_year(
            worst_opening,
            round(base_newbiz * (1 - WORST_NEWBIZ_DISCOUNT)),
            stress_adjustment_against_base(base_adjustment, base_opening),
            interest_rate,
            amortization_rate,
        )
        calculated_base[year] = annual_point(year, base_projection)
        calculated_worst[year] = annual_point(year, worst_projection)
        base_opening = base_projection["closing"]
        worst_opening = worst_projection["closing"]

    return {
        "nearTermPeriods": [f"{year}-ye" for year in DISPLAY_YEARS],
        "base": [calculated_base[year] for year in DISPLAY_YEARS],
        "worst": [calculated_worst[year] for year in DISPLAY_YEARS],
        "assumptions": {
            "rawNewbizGrowth": round(growth_policy["rawGrowth"], 6),
            "boundedNewbizGrowth": round(growth_policy["boundedGrowth"], 6),
            "newbizGrowthBounds": {
                "lower": NEWBIZ_GROWTH_BOUNDS[0],
                "upper": NEWBIZ_GROWTH_BOUNDS[1],
            },
            "optimismBiasPenalty": round(growth_policy["optimismBiasPenalty"], 6),
            "backtestMeanErrorBn": growth_policy["backtestMeanErrorBn"],
            "newbizTrendWindow": growth_policy["observations"],
            "newbizGrowthObservations": growth_policy["growthObservations"],
            "newbizGrowth": round(growth, 6),
            "baseAdjustmentRate": round(base_adjustment_rate, 6),
            "adjustmentRateMethod": adjustment_policy["method"],
            "adjustmentRateWeights": adjustment_policy["weights"],
            "adjustmentRateWindow": adjustment_policy["observations"],
            "oneOffAdjustmentPolicy": adjustment_policy["oneOffPolicy"],
            "positiveRecurringAdjustmentCap": 0.0,
            "worstNewbizStress": WORST_NEWBIZ_DISCOUNT,
            "worstAdjustmentStress": WORST_ADJUSTMENT_STRESS,
            "worstAdjustmentRatePointFloor": WORST_ADJUSTMENT_RATE_POINT_FLOOR,
            "stressCalibrationQuantile": calibration["quantile"],
            "stressCalibrationSampleCount": calibration["sampleCount"],
            "worstPolicy": {
                "basis": "전 보험사 공통 단순 하방 가정",
                "newbizDiscount": WORST_NEWBIZ_DISCOUNT,
                "adjustmentStress": WORST_ADJUSTMENT_STRESS,
                "adjustmentRatePointFloor": WORST_ADJUSTMENT_RATE_POINT_FLOOR,
                "actualLockedThroughQuarter": AS_OF_QUARTER,
            },
            "targetAdjustmentNormalization": (
                {
                    "method": "2027~2029년 3년 정액 정상화",
                    "years": TARGET_OVERLAY_NORMALIZATION_YEARS,
                    "schedule": {
                        f"{year}-ye": target_overlay_schedule[year]
                        for year in range(2026, 2030)
                    },
                }
                if target_adjustment_overlay
                else None
            ),
            "fiveYearMethod": "2026~2030년을 매년 동일한 Movement 산식으로 연결하고 Worst는 공통 단순 하방 가정으로 산출",
        },
        "executiveRationale": {
            "years1to3": (
                "최근 분기 실적과 전년 계절성으로 Base를 산출하고, 증권사 근거가 있는 회사만 제한적으로 반영. "
                f"Worst는 상반기 확정 실적은 유지하고 잔여 신계약 CSM을 Base 대비 {WORST_NEWBIZ_DISCOUNT * 100:.0f}% 낮추며 "
                f"CSM 조정은 Base 대비 {WORST_ADJUSTMENT_STRESS * 100:.0f}% 더 불리하게 적용. "
                f"단, Base 조정 부담이 매우 작을 때만 기시 CSM의 {WORST_ADJUSTMENT_RATE_POINT_FLOOR * 100:.0f}% 금액을 최소 하방으로 적용"
            ),
            "years4to5": (
                f"2024·2025년 실적과 2026년 Base를 연결한 신계약 추세에 통제를 반영해 연 {growth * 100:+.1f}%를 적용하고, "
                f"같은 3개년에서 일회성 조정을 제외한 CSM 조정률 {base_adjustment_rate * 100:+.1f}%를 유지하며, "
                + (
                    "2026년 경영목표 연결분은 2027~2029년에 3년 정액으로 정상화해 2030년까지 Movement를 연결"
                    if target_adjustment_overlay
                    else "2030년까지 Movement를 연결"
                )
            ),
        },
        "horizonConfidence": {
            "oneYear": "제한적 검증",
            "twoToThreeYears": "모델 경로",
            "fourToFiveYears": "시나리오",
        },
    }


def signed_trillion(value: int) -> str:
    return f"{value / 1000:+.2f}조원"


def worst_reason(
    base_adjustment: int,
    worst_adjustment: int,
    newbiz_stress: float,
    adjustment_stress: float,
) -> str:
    return (
        "전 보험사에 같은 단순 하방 가정을 적용. 상반기 확정 실적은 유지하고 남은 기간 "
        f"신계약 CSM을 Base 대비 {newbiz_stress * 100:.1f}% 낮추며, CSM 조정은 Base 대비 "
        f"{adjustment_stress * 100:.1f}% 더 불리하게 반영하되 충격이 작아지지 않도록 기시 CSM의 "
        f"{WORST_ADJUSTMENT_RATE_POINT_FLOOR * 100:.0f}%p를 최소 부담으로 적용. 조정은 Base {signed_trillion(base_adjustment)}에서 "
        f"Worst {signed_trillion(worst_adjustment)}으로 적용."
    )


def build_generic_movement_evidence(
    company_key: str,
    company: dict,
    actual_ytd: dict,
    base: dict,
    model_inputs: dict,
    direct_sources: list[dict],
    analyst_weight: float,
    interest_rate: float,
    amortization_rate: float,
) -> tuple[dict, list[dict]]:
    dart_source = company["periods"][AS_OF_PERIOD]["sourceReference"]
    dart_source_id = f"{company_key}-2026-q2-dart"
    methodology_source_id = f"{company_key}-forecast-methodology"
    evidence_sources = [
        {
            "id": dart_source_id,
            "title": f"{company['name']} {dart_source['reportName']}",
            "url": dart_source["dartUrl"],
            "type": "official_filing",
            "use": "2026년 상반기 누적 CSM Movement 확정값",
        },
        {
            "id": methodology_source_id,
            "title": "CSM 전망 산출 방법론",
            "url": "../CSM_FORECAST_METHODOLOGY.md",
            "type": "methodology",
            "use": "계절성·이자·조정·상각 산식과 공통 Worst 하방률 기준",
        },
    ]

    movement_meta = {
        "newbiz": {
            "label": "신계약 CSM",
            "statement": "최근 신계약 실적과 과거 분기별 계절성을 반영해 연간 신계약 CSM을 산출",
            "rateDetail": (
                f"상반기 누적 확정 {actual_ytd['newbiz'] / 1000:+.3f}조원과 잔여 2개 분기 "
                f"{base['remainingForecast']['newbiz'] / 1000:+.3f}조원을 합산"
            ),
        },
        "interest": {
            "label": "이자부리",
            "statement": "기시 CSM과 신계약 CSM 규모에 최근 4개 분기 이자부리율을 적용",
            "rateDetail": f"분기 이자부리율 {interest_rate * 100:.2f}%를 기시 CSM과 신계약 CSM 합계에 적용",
        },
        "adjustment": {
            "label": "CSM 조정",
            "statement": "과거 연간 조정률을 정상화해 일회성 환입의 반복을 차단하고 CSM 조정을 산출",
            "rateDetail": (
                f"직전 2개 연말 조정률을 35%·65%로 가중하고 양(+)의 경상 조정률은 0%로 제한해 "
                f"연간 목표 {model_inputs['drivers']['adjustment']['annualTarget'] / 1000:+.3f}조원, "
                f"잔여 조정 {base['remainingForecast']['adjustment'] / 1000:+.3f}조원을 산출"
            ),
        },
        "amortization": {
            "label": "CSM 상각",
            "statement": "보험서비스 제공에 따른 최근 CSM 상각 속도를 보유 CSM과 신계약 규모에 적용",
            "rateDetail": f"분기 상각률 {amortization_rate * 100:.2f}%를 기시 CSM과 신계약 CSM 합계에 적용",
        },
    }
    movement_evidence = {}
    analyst_source = direct_sources[0] if direct_sources else None
    for key, meta in movement_meta.items():
        items = [
            {
                "kind": "actual",
                "label": "확정 실적",
                "headline": f"2026년 상반기 {meta['label']} {actual_ytd[key] / 1000:+.3f}조원",
                "detail": "DART 반기보고서에서 파싱·검증한 2026년 상반기 누적 확정 Movement",
                "sourceId": dart_source_id,
            },
            {
                "kind": "model",
                "label": "산출식",
                "headline": f"2026년 연간 {meta['label']} {base[key] / 1000:+.3f}조원",
                "detail": meta["rateDetail"],
                "sourceId": methodology_source_id,
            },
        ]
        if key in ("newbiz", "adjustment"):
            items.append(
                {
                    "kind": "analyst" if analyst_source else "control",
                    "label": "애널리스트 반영" if analyst_source else "외부 보정 통제",
                    "headline": (
                        f"회사별 직접 리포트 {analyst_weight * 100:.0f}% 반영"
                        if analyst_source
                        else "회사별 직접 리포트 미확인·외부 보정 0%"
                    ),
                    "detail": (
                        analyst_source["use"]
                        if analyst_source
                        else "업종 공통 자료는 방향성 참고에만 사용하고 회사 전망 숫자에는 반영하지 않음"
                    ),
                    "sourceId": analyst_source["id"] if analyst_source else methodology_source_id,
                }
            )
        movement_evidence[key] = {"statement": meta["statement"], "items": items}
    return movement_evidence, evidence_sources


def samsung_life_driver_inputs(periods: dict, model_inputs: dict) -> dict:
    """Create an auditable Samsung Life central driver bridge without mixing incompatible APE bases."""
    ytd_shares = []
    for year in available_history_years(periods, FORECAST_YEAR):
        annual_newbiz = periods[f"{year}-ye"]["movement"]["newbiz"]
        ytd_newbiz = sum(
            periods[f"{year}-q{quarter}"]["movement"]["newbiz"]
            for quarter in ACTUAL_QUARTERS
        )
        if annual_newbiz:
            ytd_shares.append({"year": year, "share": ytd_newbiz / annual_newbiz})

    median_ytd_share = statistics.median(item["share"] for item in ytd_shares)
    actual_ytd = sum(
        periods[f"{FORECAST_YEAR}-q{quarter}"]["movement"]["newbiz"]
        for quarter in ACTUAL_QUARTERS
    )
    ytd_run_rate_total = round(actual_ytd / median_ytd_share)
    ytd_run_rate_remaining = ytd_run_rate_total - actual_ytd
    statistical_remaining = model_inputs["remainingNewbiz"]

    # The half-year actual receives a bounded weight while historical seasonality
    # remains the primary estimate until a company-specific 2Q analyst report exists.
    run_rate_weight = 0.30
    p50_remaining_newbiz = round(
        statistical_remaining * (1 - run_rate_weight)
        + ytd_run_rate_remaining * run_rate_weight
    )

    recurring_observations = []
    for year in available_history_years(periods, FORECAST_YEAR):
        values = [
            periods[f"{year}-q{quarter}"]["movement"]["adjustment"]
            for quarter in FORECAST_QUARTERS
        ]
        event_value = max(values, key=abs)
        recurring_observations.append(
            {
                "year": year,
                "q3ToQ4": sum(values),
                "largestAbsoluteQuarter": event_value,
                "recurringExEvent": sum(values) - event_value,
            }
        )
    recurring_adjustment = round(
        statistics.median(item["recurringExEvent"] for item in recurring_observations)
    )
    p50_remaining_adjustment = model_inputs["remainingAdjustment"]
    annual_review_reserve = p50_remaining_adjustment - recurring_adjustment

    return {
        "newBusiness": {
            "statisticalRemaining": statistical_remaining,
            "actualYtd": actual_ytd,
            "historicalYtdShares": [
                {**item, "share": round(item["share"], 6)} for item in ytd_shares
            ],
            "medianYtdShare": round(median_ytd_share, 6),
            "ytdRunRateRemaining": ytd_run_rate_remaining,
            "runRateWeight": run_rate_weight,
            "p50Remaining": p50_remaining_newbiz,
            "driverSignals": [
                {
                    "driver": "distribution",
                    "signal": "positive",
                    "evidence": "FC headcount increased by about 1,500 year-to-date",
                },
                {
                    "driver": "productMix",
                    "signal": "positive",
                    "evidence": "health products remained the main new-business growth driver",
                },
                {
                    "driver": "lapseAndExpense",
                    "signal": "watch",
                    "evidence": "early-year lapse and cancellation rates rose 1-2% before stabilizing",
                },
            ],
        },
        "adjustment": {
            "p50Remaining": p50_remaining_adjustment,
            "components": {
                "recurringExperience": recurring_adjustment,
                "annualAssumptionReviewReserve": annual_review_reserve,
                "incrementalLapseOverlay": 0,
                "unidentifiedEventOverlay": 0,
            },
            "recurringObservations": recurring_observations,
            "managementSignal": "해지율은 2~3월 안정화됐고 추가 대규모 해지 가정 조정은 예상 CSM에 반영하지 않음",
        },
        "inputPolicy": {
            "apeUsed": False,
            "newBusinessMultipleUsed": False,
            "excludedMetric": "2026년 1분기 11.4배 신계약 지표",
            "reason": "2025년 APE 대비 CSM 비율과 2026년 발표 배수의 분모 정의가 같다고 검증되지 않아 직접 환산에서 제외",
        },
    }


def build_samsung_driver_forecast(
    actual_movements: list[dict],
    opening: int,
    inputs: dict,
    model_inputs: dict,
    interest_rate: float,
    amortization_rate: float,
    calibration: dict,
    known_base_anchor: dict | None = None,
) -> dict:
    actual_ytd = {
        key: sum(item[key] for item in actual_movements)
        for key in ("newbiz", "interest", "adjustment", "amortization")
    }
    p50_newbiz = inputs["newBusiness"]["p50Remaining"]
    p50_adjustment = inputs["adjustment"]["p50Remaining"]
    newbiz_error = WORST_NEWBIZ_DISCOUNT
    adjustment_error = WORST_ADJUSTMENT_STRESS
    stressed_adjustment = stress_adjustment_against_base(p50_adjustment, opening, adjustment_error)

    def scenario(newbiz: int, adjustment: int, label: str, description: str) -> dict:
        remaining = project(
            opening,
            newbiz,
            adjustment,
            model_inputs["newbizShares"],
            model_inputs["adjustmentShares"],
            interest_rate,
            amortization_rate,
        )
        annual = annualize(actual_movements, remaining)
        annual.update({"label": label, "description": description})
        return annual

    model_p10 = scenario(
        round(p50_newbiz * (1 - newbiz_error)),
        stressed_adjustment,
        "Worst",
        "상반기 확정 실적은 유지하고 남은 기간 신계약 CSM과 CSM 조정에 공통 하방률을 적용한 경우",
    )
    model_p50 = scenario(
        p50_newbiz,
        p50_adjustment,
        "Base",
        "상반기 판매 흐름을 일부 이어가되 과도하게 연장하지 않은 Base 경로",
    )
    p50 = deepcopy(model_p50)
    anchor_reconciliation = 0
    if known_base_anchor:
        anchor_reconciliation = known_base_anchor["value"] - model_p50["closing"]
        reconcile_annual_to_anchor(p50, known_base_anchor["value"])

    scenario_base_newbiz = p50["remainingForecast"]["newbiz"]
    scenario_base_adjustment = p50["remainingForecast"]["adjustment"]
    scenario_worst_newbiz, scenario_worst_adjustment = simple_worst_inputs(
        scenario_base_newbiz,
        scenario_base_adjustment,
        opening,
    )
    p10 = scenario(
        scenario_worst_newbiz,
        scenario_worst_adjustment,
        "Worst",
        "상반기 확정 실적은 유지하고 최종 Base의 남은 기간 신계약 CSM과 CSM 조정에 공통 하방률을 적용한 경우",
    )
    stresses = {
        "salesSlowdown": scenario(
            scenario_worst_newbiz,
            scenario_base_adjustment,
            "신계약 CSM 하방",
            f"판매량 감소 또는 상품 믹스·계약당 수익성 저하를 단순화해 잔여 신계약 CSM을 Base 대비 {newbiz_error * 100:.0f}% 낮추는 경우",
        ),
        "marginCompression": scenario(
            scenario_worst_newbiz,
            scenario_base_adjustment,
            "수익성 압박",
            f"상품 믹스와 계약당 수익성이 낮아져 잔여 신계약 CSM을 Base 대비 {newbiz_error * 100:.0f}% 낮추는 경우",
        ),
        "lapseAndExpense": scenario(
            scenario_base_newbiz,
            scenario_worst_adjustment,
            "장래손해율·해지·비용 부담",
            f"판매는 계획대로 진행되지만 장래손해율 상승, 해지 증가 또는 사업비 가정 악화로 CSM 조정을 Base 대비 {adjustment_error * 100:.0f}% 더 불리하게 보는 경우",
        ),
        "combined": scenario(
            scenario_worst_newbiz,
            scenario_worst_adjustment,
            "복합 스트레스",
            "전 보험사 공통 Worst 룰에 따라 신계약 CSM 하방과 CSM 조정 악화를 동시에 반영한 경로",
        ),
    }

    movement_evidence = {
        "newbiz": {
            "statement": "상반기 확정 판매 흐름과 과거 하반기 계절성을 반영하되 연중 과도한 연율화는 제한",
            "items": [
                {
                    "kind": "actual",
                    "label": "확정 실적",
                    "headline": f"2026년 상반기 신계약 CSM {actual_ytd['newbiz'] / 1000:.3f}조원",
                    "detail": "반기보고서 기준 1~2분기 누적 확정 Movement",
                    "sourceId": "samsung-2026-q2-dart",
                },
                {
                    "kind": "management",
                    "label": "경영진 설명",
                    "headline": "전속·비전속 채널 동반 성장과 FC 약 1,500명 증가",
                    "detail": "건강보험 상품이 향후 성장의 중심이며 수익성이 양호한 상품 판매가 신계약 CSM 증가를 뒷받침했다고 설명",
                    "sourceId": "samsung-2026-q1-call",
                },
                {
                    "kind": "model",
                    "label": "산출식",
                    "headline": f"잔여 2개 분기 {p50_newbiz / 1000:.3f}조원",
                    "detail": (
                        f"과거 계절성 잔여 전망 {inputs['newBusiness']['statisticalRemaining'] / 1000:.3f}조원 70%와 "
                        f"상반기 런레이트 잔여 전망 {inputs['newBusiness']['ytdRunRateRemaining'] / 1000:.3f}조원 30%를 결합. "
                        f"상반기 확정치를 더한 연간 신계약 CSM은 {p50['newbiz'] / 1000:.3f}조원"
                    ),
                    "sourceId": "csm-forecast-methodology",
                },
            ],
        },
        "interest": {
            "statement": "보유 CSM과 신계약 CSM 증가에 연동해 이자부리 효과를 산출",
            "items": [
                {
                    "kind": "actual",
                    "label": "확정 실적",
                    "headline": f"2026년 상반기 이자부리 {actual_ytd['interest'] / 1000:+.3f}조원",
                    "detail": "DART 반기보고서에서 파싱·검증한 상반기 누적 CSM Movement",
                    "sourceId": "samsung-2026-q2-dart",
                },
                {
                    "kind": "model",
                    "label": "산출식",
                    "headline": f"연간 이자부리 {p50['interest'] / 1000:+.3f}조원",
                    "detail": (
                        f"최근 4개 분기에서 계산한 분기 이자부리율 {interest_rate * 100:.2f}%를 "
                        "각 분기 기시 CSM과 신계약 CSM 합계에 적용해 분기별로 재계산"
                    ),
                    "sourceId": "csm-forecast-methodology",
                },
            ],
        },
        "adjustment": {
            "statement": (
                "해지 흐름 안정화와 연말 계리 가정 재점검 부담을 반영"
                + (
                    f". 경상 조정과 별도로 {known_base_anchor['value'] / 1000:.1f}조원 경영목표 연결분 "
                    f"{anchor_reconciliation / 1000:+.2f}조원을 CSM 조정에 포함"
                    if known_base_anchor
                    else ""
                )
            ),
            "items": [
                {
                    "kind": "actual",
                    "label": "확정 실적",
                    "headline": f"2026년 상반기 CSM 조정 {actual_ytd['adjustment'] / 1000:+.3f}조원",
                    "detail": "DART 반기보고서 기준 확정 Movement. 연간 Base는 상반기 확정치를 변경하지 않음",
                    "sourceId": "samsung-2026-q2-dart",
                },
                {
                    "kind": "management",
                    "label": "경영진 설명",
                    "headline": "해지·취소율 상승 후 2~3월 안정화",
                    "detail": "해지·취소율이 약 1~2% 상승했으나 안정화됐고, 현 상황에서는 연중 대규모 해지 가정 조정을 예상하지 않는다고 설명",
                    "sourceId": "samsung-2026-q1-call",
                },
                {
                    "kind": "model",
                    "label": "조정 브리지",
                    "headline": f"연간 CSM 조정 {p50['adjustment'] / 1000:+.3f}조원",
                    "detail": (
                        f"잔여 조정 {p50_adjustment / 1000:+.3f}조원을 반복 경험조정 "
                        f"{inputs['adjustment']['components']['recurringExperience'] / 1000:+.3f}조원과 "
                        f"연말 가정 재점검 예비분 {inputs['adjustment']['components']['annualAssumptionReviewReserve'] / 1000:+.3f}조원"
                        + (
                            f"으로 구분. 여기에 {known_base_anchor['value'] / 1000:.1f}조원 경영목표 연결분 "
                            f"{anchor_reconciliation / 1000:+.3f}조원을 별도 추가해 연간 CSM 조정에 포함"
                            if known_base_anchor
                            else "으로 구분"
                        )
                    ),
                    "sourceId": "csm-forecast-methodology",
                },
            ],
        },
        "amortization": {
            "statement": "보유 CSM 증가와 보험서비스 제공 확대에 따라 손익 인식 규모가 소폭 증가",
            "items": [
                {
                    "kind": "actual",
                    "label": "확정 실적",
                    "headline": f"2026년 상반기 CSM 상각 {actual_ytd['amortization'] / 1000:+.3f}조원",
                    "detail": "DART 반기보고서 기준 보험서비스 제공에 따라 손익으로 인식된 확정 CSM Movement",
                    "sourceId": "samsung-2026-q2-dart",
                },
                {
                    "kind": "model",
                    "label": "산출식과 한계",
                    "headline": f"연간 CSM 상각 {p50['amortization'] / 1000:+.3f}조원",
                    "detail": (
                        f"최근 4개 분기 상각률 {amortization_rate * 100:.2f}%를 각 분기 기시 CSM과 신계약 CSM 합계에 적용. "
                        "상품군별 coverage unit 원자료가 정규화되기 전까지 실제 상각률을 서비스 제공률 대용치로 사용"
                    ),
                    "sourceId": "csm-forecast-methodology",
                },
            ],
        },
    }

    return {
        "modelVersion": "samsung-driver-ensemble/v5",
        "status": "pilot",
        "asOfPeriod": AS_OF_PERIOD,
        "targetPeriod": "2026-ye",
        "interval": {
            "type": "common deterministic downside scenario",
            "coverage": None,
            "sampleCount": calibration["sampleCount"],
            "sectorSampleCount": calibration.get("sectorSampleCount"),
            "companyBacktestSamples": calibration["sampleCount"],
            "newbizDiscount": WORST_NEWBIZ_DISCOUNT,
            "adjustmentStress": WORST_ADJUSTMENT_STRESS,
            "adjustmentRatePointFloor": WORST_ADJUSTMENT_RATE_POINT_FLOOR,
            "interpretation": "Base는 경영입력 또는 모델 경로이며 Worst는 모든 보험사에 동일한 단순 하방률을 적용한 경영진 검토용 시나리오",
        },
        "distribution": {"p10": p10, "p50": p50},
        "independentModel": {"base": model_p50, "worst": model_p10},
        "newBusinessBridge": inputs["newBusiness"],
        "serviceRelease": {
            "method": "최근 4개 분기 coverage-unit 서비스 제공률 대용치",
            "rate": round(amortization_rate, 6),
            "denominator": "기시 CSM + 신계약 CSM",
            "lookbackPeriods": model_inputs["drivers"]["rateLookbackPeriods"],
            "actualYtdAmortization": actual_ytd["amortization"],
            "limitation": "상품군별 coverage unit 원자료가 정규화되기 전까지 실제 CSM 상각률을 서비스 제공률 대용치로 사용",
        },
        "adjustmentBridge": inputs["adjustment"],
        "movementEvidence": movement_evidence,
        "stressScenarios": stresses,
        "inputPolicy": inputs["inputPolicy"],
        "knownBaseAnchor": (
            {
                **known_base_anchor,
                "modelClosing": known_base_anchor["value"] - anchor_reconciliation,
                "reconciliation": anchor_reconciliation,
                "application": "2026년 Base의 CSM 조정에 목표 연결분을 별도 반영하고 2027~2029년 3년 정액으로 정상화",
            }
            if known_base_anchor
            else None
        ),
        "sources": SAMSUNG_LIFE_DRIVER_SOURCES,
    }


def build() -> dict:
    source = json.loads(SOURCE.read_text(encoding="utf-8"))["sampleData"]
    backtest = build_backtest_registry(source)
    forecasts = {}
    for company_key, config in CONFIG.items():
        company = source[company_key]
        periods = company["periods"]
        company_backtest = backtest["byCompany"][company_key]
        calibration = blend_calibration(
            company_backtest["calibration"],
            backtest["bySector"][company["sector"]],
        )
        opening = round(periods[AS_OF_PERIOD]["csm"])
        actual_movements = [
            {
                "period": f"{FORECAST_YEAR}-q{quarter}",
                "actual": True,
                **periods[f"{FORECAST_YEAR}-q{quarter}"]["movement"],
            }
            for quarter in ACTUAL_QUARTERS
        ]
        actual_ytd = {
            key: sum(item[key] for item in actual_movements)
            for key in ("newbiz", "interest", "adjustment", "amortization")
        }
        realized_after_q1 = periods[AS_OF_PERIOD]["movement"]
        model_inputs = estimate_model_inputs(periods, FORECAST_YEAR)
        interest_rate = config.get("interest_rate_override") or model_inputs["interestRate"]
        amortization_rate = model_inputs["amortizationRate"]
        analyst_weight = ANALYST_OVERLAY_WEIGHT if config["sources"] else 0
        model_weight = 1 - analyst_weight
        analyst_remaining_newbiz = config["base_newbiz"] - realized_after_q1["newbiz"]
        analyst_remaining_adjustment = config["base_adjustment"] - realized_after_q1["adjustment"]
        base_newbiz = round(
            model_inputs["remainingNewbiz"] * model_weight
            + analyst_remaining_newbiz * analyst_weight
        )
        base_adjustment = round(
            model_inputs["remainingAdjustment"] * model_weight
            + analyst_remaining_adjustment * analyst_weight
        )
        driver_inputs = None
        if company_key == "samsung-life":
            driver_inputs = samsung_life_driver_inputs(periods, model_inputs)
            base_newbiz = driver_inputs["newBusiness"]["p50Remaining"]
            base_adjustment = driver_inputs["adjustment"]["p50Remaining"]
        base_remaining = project(
            opening,
            base_newbiz,
            base_adjustment,
            model_inputs["newbizShares"],
            model_inputs["adjustmentShares"],
            interest_rate,
            amortization_rate,
        )
        worst_newbiz, worst_adjustment = simple_worst_inputs(base_newbiz, base_adjustment, opening)
        worst_remaining = project(
            opening,
            worst_newbiz,
            worst_adjustment,
            model_inputs["newbizShares"],
            model_inputs["adjustmentShares"],
            interest_rate,
            amortization_rate,
        )
        base = annualize(actual_movements, base_remaining)
        worst = annualize(actual_movements, worst_remaining)
        known_base_anchor = config.get("known_base_anchor")
        independent_model_base = deepcopy(base)
        independent_model_worst = deepcopy(worst)
        model_generated_base_closing = base["closing"]
        anchor_reconciliation = 0
        if known_base_anchor:
            anchor_reconciliation = reconcile_annual_to_anchor(
                base,
                known_base_anchor["value"],
            )
            worst_newbiz, worst_adjustment = simple_worst_inputs(
                base["remainingForecast"]["newbiz"],
                base["remainingForecast"]["adjustment"],
                opening,
            )
            worst_remaining = project(
                opening,
                worst_newbiz,
                worst_adjustment,
                model_inputs["newbizShares"],
                model_inputs["adjustmentShares"],
                interest_rate,
                amortization_rate,
            )
            worst = annualize(actual_movements, worst_remaining)
        overlay_note = (
            f" 증권사 근거가 있는 정성 입력을 {analyst_weight * 100:.0f}% 오버레이."
            if analyst_weight
            else " 회사별 직접 근거가 없어 정성 오버레이는 0%."
        )
        base_rationale = (
            "전년 동기간 계절성, 상반기 성장 신호, 직전 2개 연말 정상화 조정률과 최근 4개 분기 "
            f"이자·상각률로 산출.{overlay_note}"
        )
        if known_base_anchor:
            base_rationale = (
                f"사용자 제공 2026년말 CSM 목표 {known_base_anchor['value'] / 1000:.1f}조원을 경영계획 Base로 적용. "
                f"독립 모델 {model_generated_base_closing / 1000:.3f}조원과의 차이 "
                f"{anchor_reconciliation / 1000:+.3f}조원을 경영목표 연결 조정으로 분리."
            )
        base.update({"rationale": base_rationale})
        worst_rationale = worst_reason(
            base["remainingForecast"]["adjustment"],
            worst["remainingForecast"]["adjustment"],
            WORST_NEWBIZ_DISCOUNT,
            WORST_ADJUSTMENT_STRESS,
        )
        worst.update({"rationale": worst_rationale})
        horizon = build_horizon(
            periods,
            base,
            worst,
            interest_rate,
            amortization_rate,
            calibration,
            company_backtest,
        )
        direct_sources = [
            {**source, "id": source.get("id", f"{company_key}-analyst-{index + 1}")}
            for index, source in enumerate(config["sources"])
        ]
        general_sources = [
            {**source, "id": source.get("id", f"{company_key}-industry-{index + 1}")}
            for index, source in enumerate(GENERAL_SOURCES)
        ]
        sources = direct_sources + general_sources
        if not sources or any(source["type"] != "sell_side" for source in sources):
            raise ValueError(f"{company_key}: forecast sources must be securities analyst reports only")
        movement_evidence, evidence_sources = build_generic_movement_evidence(
            company_key,
            company,
            actual_ytd,
            base,
            model_inputs,
            direct_sources,
            analyst_weight,
            interest_rate,
            amortization_rate,
        )
        anchor = {
            "type": "model_generated",
            "value": base["closing"],
            "note": "담당자 입력값 없음 · 모델 예상치를 사용",
        }
        if known_base_anchor:
            anchor = {
                "type": "management_target",
                "value": known_base_anchor["value"],
                "label": known_base_anchor["label"],
                "sourceType": known_base_anchor["sourceType"],
                "source": known_base_anchor["source"],
                "receivedAt": known_base_anchor["receivedAt"],
                "verificationStatus": known_base_anchor["verificationStatus"],
                "verificationLabel": known_base_anchor["verificationLabel"],
                "originalAttached": known_base_anchor["originalAttached"],
                "modelClosing": model_generated_base_closing,
                "reconciliation": anchor_reconciliation,
                "note": "사용자 제공 목표를 경영계획 Base로 사용 · 모델 차이는 경영목표 연결 조정으로 분리",
            }
        direct_analyst_count = len(direct_sources) + (1 if company_key == "samsung-life" else 0)
        evidence_rating = (
            "입력 검증 필요"
            if known_base_anchor and known_base_anchor["verificationStatus"] != "verified"
            else "근거 보통"
            if direct_analyst_count
            else "모델 중심"
        )
        forecast_entry = {
            "companyName": company["name"],
            "asOfPeriod": AS_OF_PERIOD,
            "asOfCsm": opening,
            "targetPeriod": "2026-ye",
            "anchor": anchor,
            "ratios": {
                "interestRate": round(interest_rate, 6),
                "amortizationRate": round(amortization_rate, 6),
                "denominator": "기시 CSM + 신계약 CSM",
                "lookbackPeriods": model_inputs["drivers"]["rateLookbackPeriods"],
                "lookbackWeights": LOOKBACK_WEIGHTS,
                "interestOverride": company_key == "kyobo-life",
            },
            "base": base,
            "worst": worst,
            "independentModel": {
                "base": independent_model_base,
                "worst": independent_model_worst,
            },
            "horizon": horizon,
            "model": {
                "version": "rolling-origin-current-year/v5",
                "baseline": {
                    "remainingNewbiz": model_inputs["remainingNewbiz"],
                    "remainingAdjustment": model_inputs["remainingAdjustment"],
                    "newbizShares": [round(value, 6) for value in model_inputs["newbizShares"]],
                    "adjustmentShares": [round(value, 6) for value in model_inputs["adjustmentShares"]],
                    "drivers": model_inputs["drivers"],
                },
                "analystOverlay": {
                    "weight": analyst_weight,
                    "remainingNewbiz": analyst_remaining_newbiz if analyst_weight else None,
                    "remainingAdjustment": analyst_remaining_adjustment if analyst_weight else None,
                    "originalQ1RemainingNewbiz": config["base_newbiz"] if analyst_weight else None,
                    "originalQ1RemainingAdjustment": config["base_adjustment"] if analyst_weight else None,
                    "realizedQ2Newbiz": realized_after_q1["newbiz"] if analyst_weight else None,
                    "realizedQ2Adjustment": realized_after_q1["adjustment"] if analyst_weight else None,
                    "reason": (
                        config["base_newbiz_reason"] + " " + config["base_adjustment_reason"]
                        if analyst_weight
                        else "회사별 직접 증권사 근거가 없어 미적용"
                    ),
                },
                "finalInputs": {
                    "remainingNewbiz": base_newbiz,
                    "remainingAdjustment": base_adjustment,
                },
                "backtest": company_backtest,
            },
            "qualitativeJudgment": {
                "baseNewbiz": (
                    f"데이터 모델 {model_inputs['remainingNewbiz'] / 1000:.2f}조원"
                    + (
                        f"과 기존 애널리스트 잔여 관점에서 2분기 실적을 차감한 {analyst_remaining_newbiz / 1000:.2f}조원을 "
                        f"{analyst_weight * 100:.0f}% 가중해 {base_newbiz / 1000:.2f}조원 적용."
                        if analyst_weight
                        else f"을 그대로 적용. {model_inputs['drivers']['newbiz']['appliedGrowthSignal'] * 100:+.1f}% 성장 신호 반영."
                    )
                ),
                "baseAdjustment": (
                    f"직전 2개 연말 조정률을 35%·65% 가중하고 양(+) 경상률을 0%로 제한한 "
                    f"정상화 기준 {model_inputs['remainingAdjustment'] / 1000:+.2f}조원"
                    + (
                        f"에 애널리스트 판단을 {analyst_weight * 100:.0f}% 가중해 {base_adjustment / 1000:+.2f}조원 적용."
                        if analyst_weight
                        else "을 그대로 적용."
                    )
                ),
                "targetAdjustmentOverlay": (
                    f"경영계획 Base {known_base_anchor['value'] / 1000:.2f}조원과 독립 모델 "
                    f"{model_generated_base_closing / 1000:.2f}조원의 차이 {anchor_reconciliation / 1000:+.2f}조원. "
                    "경영목표 연결 조정으로 분리."
                    if known_base_anchor
                    else "경영목표 연결 조정 없음"
                ),
                "worst": worst_rationale,
            },
            "worstAssumption": {
                "basis": "전 보험사 공통 단순 하방 가정",
                "scope": "2026년 상반기 확정 실적은 유지하고 Q3~Q4 전망 입력에만 적용",
                "newbizDiscount": WORST_NEWBIZ_DISCOUNT,
                "adjustmentStress": WORST_ADJUSTMENT_STRESS,
                "adjustmentRatePointFloor": WORST_ADJUSTMENT_RATE_POINT_FLOOR,
                "adjustmentDirection": "Base보다 10% 불리하게 적용. 단, Base 조정 부담이 매우 작을 때만 기시 CSM의 1% 금액을 최소 하방으로 사용",
            },
            "confidence": company_backtest["validationLabel"],
            "validation": {
                "label": company_backtest["validationLabel"],
                "sampleCount": company_backtest["sampleCount"],
                "meanAbsolutePercentageError": company_backtest["meanAbsolutePercentageError"],
                "meanAbsoluteErrorBn": company_backtest["meanAbsoluteErrorBn"],
                "meanErrorBn": company_backtest["meanErrorBn"],
                "scope": "회사별 2024·2025년 Q1·Q2·Q3 시점 연말 예측",
                "limitation": "IFRS17 이후 2개 연도·6개 시점으로 장기 확률 신뢰도로 해석하지 않음",
            },
            "evidenceProfile": {
                "rating": evidence_rating,
                "directAnalystSourceCount": direct_analyst_count,
                "officialActual": True,
                "anchorVerificationStatus": known_base_anchor.get("verificationStatus") if known_base_anchor else "not_applicable",
                "categories": ["확정 사실", "외부 전망", "모델 추정", "경영 입력", "가정"],
            },
            "sources": sources,
            "evidenceSources": evidence_sources,
            "movementEvidence": movement_evidence,
        }
        if driver_inputs:
            driver_forecast = build_samsung_driver_forecast(
                actual_movements,
                opening,
                driver_inputs,
                model_inputs,
                interest_rate,
                amortization_rate,
                calibration,
                known_base_anchor,
            )
            forecast_entry["driverForecast"] = driver_forecast
            if not known_base_anchor:
                forecast_entry["anchor"] = {
                    "type": "driver_p50",
                    "value": base["closing"],
                    "note": "삼성생명 Driver Forecast 중앙 경로를 예상치로 사용",
                }
            forecast_entry["model"]["version"] = "samsung-driver-ensemble/v5"
            forecast_entry["model"]["finalInputs"] = {
                "remainingNewbiz": base_newbiz,
                "remainingAdjustment": base_adjustment,
            }
            forecast_entry["qualitativeJudgment"]["baseNewbiz"] = (
                f"상반기 신계약 CSM 흐름을 반영하되 그대로 연율화하지 않고 "
                f"과거 하반기 판매 패턴과 함께 적용해 남은 2개 분기 {base_newbiz / 1000:.2f}조원으로 전망."
            )
            forecast_entry["qualitativeJudgment"]["baseAdjustment"] = (
                f"통상적인 경험조정과 연말 계리 가정 재점검 부담을 구분해 반영. "
                f"현재 해지 흐름이 안정화된 점을 감안하되 연말 변동 가능성을 남겨 잔여 모델 조정 {base_adjustment / 1000:+.2f}조원 적용. "
                + (
                    f"경상 조정과 별도로 {known_base_anchor['value'] / 1000:.1f}조원 경영목표 연결분 "
                    f"{anchor_reconciliation / 1000:+.2f}조원을 CSM 조정에 포함."
                    if known_base_anchor
                    else ""
                )
            )
            forecast_entry["base"]["rationale"] = (
                f"사용자 제공 2026년말 CSM 목표 {known_base_anchor['value'] / 1000:.1f}조원을 경영계획 Base로 적용했습니다. "
                f"독립 Driver 모델 대비 {anchor_reconciliation / 1000:+.3f}조원 차이를 경영목표 연결 조정으로 분리했습니다."
                if known_base_anchor
                else (
                    "상반기 신계약 흐름이 연중 일부 이어지는 것으로 보되 과도한 연율화는 피했습니다. "
                    "보험서비스 제공에 따른 CSM 인식과 연말 계리 가정 재점검 부담까지 반영한 Base입니다."
                )
            )
            samsung_downside_rationale = (
                f"전 보험사 공통 Worst 룰입니다. 상반기 확정 실적은 유지하고 남은 기간 신계약 CSM은 Base 대비 "
                f"{WORST_NEWBIZ_DISCOUNT * 100:.0f}% 낮추며, CSM 조정은 Base 대비 {WORST_ADJUSTMENT_STRESS * 100:.0f}% "
                "더 불리하게 적용합니다. 삼성생명은 10% 악화 금액이 내부 최소 충격 기준보다 커서 "
                "최소 충격 기준이 전망값에 추가 영향을 주지 않습니다. "
                "CSM 조정 부담에는 장래손해율 상승, 해지 증가 및 사업비 가정 악화를 포함합니다."
            )
            forecast_entry["worst"]["rationale"] = samsung_downside_rationale
            forecast_entry["qualitativeJudgment"]["worst"] = samsung_downside_rationale
            forecast_entry["horizon"]["executiveRationale"]["years1to3"] = (
                "2026년은 사용자 제공 CSM 목표 13.5조원을 경영계획 Base로 적용하고 독립 모델 전망을 병렬 공개. "
                f"Worst는 같은 목표를 출발점으로 잔여 신계약 CSM -{WORST_NEWBIZ_DISCOUNT * 100:.0f}%, "
                f"CSM 조정 {WORST_ADJUSTMENT_STRESS * 100:.0f}% 악화의 공통 하방률을 적용. "
                "2026년 목표 연결분은 2027~2029년에 3년 정액으로 정상화해 연도 간 일시적 급증을 제한"
                if known_base_anchor
                else (
                    "2026년은 현재 판매 흐름과 CSM 인식·조정 부담을 반영한 Base로 산출. "
                    f"Worst는 잔여 신계약 CSM -{WORST_NEWBIZ_DISCOUNT * 100:.0f}%, CSM 조정 {WORST_ADJUSTMENT_STRESS * 100:.0f}% 악화의 공통 하방률을 적용하고, 2027~2028년은 같은 사업 흐름을 이어 계산"
                )
            )
        forecasts[company_key] = forecast_entry
    return {
        "version": "2026.08.21-v10.3",
        "generatedAt": "2026-08-21",
        "asOfPeriod": AS_OF_PERIOD,
        "targetPeriod": "2026-ye",
        "nearTermPeriods": [f"{year}-ye" for year in DISPLAY_YEARS],
        "unit": "KRW billion",
        "status": "decision-support scenario; not company guidance",
        "methodologyDocument": "../CSM_FORECAST_METHODOLOGY.md",
        "methodology": {
            "model": "rolling-origin-current-year/v5 + samsung-driver-ensemble/v5",
            "base": "independent model view with separately disclosed management-case reconciliation",
            "stress": "common downside: Q3-Q4 newbiz -10%, CSM adjustment 10% worse with 1% of opening CSM floor",
            "analystOverlayWeight": ANALYST_OVERLAY_WEIGHT,
            "driverPilot": "Samsung Life driver scenario ensemble",
            "worst": {
                "basis": "same rule for all nine insurers",
                "actualLockedThroughQuarter": AS_OF_QUARTER,
                "newbizDiscount": WORST_NEWBIZ_DISCOUNT,
                "adjustmentStress": WORST_ADJUSTMENT_STRESS,
                "adjustmentRatePointFloor": WORST_ADJUSTMENT_RATE_POINT_FLOOR,
            },
        },
        "backtest": {
            "method": backtest["method"],
            "years": backtest["years"],
            "originQuarters": backtest["originQuarters"],
            "global": backtest["global"],
            "bySector": backtest["bySector"],
        },
        "forecasts": forecasts,
    }


if __name__ == "__main__":
    payload = build()
    OUTPUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    OUTPUT_JS.write_text("window.CSM_FORECAST_DATA = " + json.dumps(payload, ensure_ascii=False, indent=2) + ";\n", encoding="utf-8")
    print(f"wrote {OUTPUT_JSON}")
    print(f"wrote {OUTPUT_JS}")
