# -*- coding: utf-8 -*-
"""Build explainable near- and long-term CSM forecasts for the nine-company dashboard."""

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
CALCULATION_YEARS = range(2026, 2031)
DISPLAY_YEARS = (2026, 2027, 2028, 2030)
TERMINAL_YEAR = 2035

GENERAL_SOURCES = [
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
        "id": "samsung-2026-q1-dart",
        "title": "삼성생명 2026년 1분기 분기보고서",
        "url": "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260515002696",
        "type": "official_filing",
        "use": "2026년 1분기 CSM과 신계약 CSM 실제값의 원문 기준점",
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


def weighted_rate(periods: dict, key: str, as_of_period: str = "2026-q1") -> float:
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


def seasonal_shares(periods: dict, forecast_year: int, key: str) -> list[float]:
    yearly_shares = []
    for year in available_history_years(periods, forecast_year):
        values = [abs(periods[f"{year}-q{quarter}"]["movement"][key]) for quarter in (2, 3, 4)]
        total = sum(values)
        if total:
            yearly_shares.append([value / total for value in values])
    if not yearly_shares:
        return [1 / 3, 1 / 3, 1 / 3]
    shares = [statistics.mean(year[index] for year in yearly_shares) for index in range(3)]
    total = sum(shares)
    return [share / total for share in shares]


def estimate_remaining_newbiz(periods: dict, forecast_year: int) -> tuple[int, dict]:
    prior_year = forecast_year - 1
    prior_remaining = sum(
        periods[f"{prior_year}-q{quarter}"]["movement"]["newbiz"] for quarter in (2, 3, 4)
    )
    current_q1 = periods[f"{forecast_year}-q1"]["movement"]["newbiz"]
    prior_q1 = periods[f"{prior_year}-q1"]["movement"]["newbiz"]
    q1_growth = current_q1 / prior_q1 - 1 if prior_q1 else 0

    earlier_year = forecast_year - 2
    if all(f"{earlier_year}-q{quarter}" in periods for quarter in (2, 3, 4)):
        earlier_remaining = sum(
            periods[f"{earlier_year}-q{quarter}"]["movement"]["newbiz"]
            for quarter in (2, 3, 4)
        )
        annual_growth = prior_remaining / earlier_remaining - 1 if earlier_remaining else 0
        raw_signal = q1_growth * 0.65 + annual_growth * 0.35
    else:
        annual_growth = None
        raw_signal = q1_growth

    applied_signal = clamp(raw_signal * 0.5, -0.20, 0.20)
    estimate = round(prior_remaining * (1 + applied_signal))
    return estimate, {
        "priorYearRemaining": prior_remaining,
        "q1Growth": round(q1_growth, 6),
        "priorRemainingGrowth": round(annual_growth, 6) if annual_growth is not None else None,
        "appliedGrowthSignal": round(applied_signal, 6),
    }


def estimate_remaining_adjustment(periods: dict, forecast_year: int) -> tuple[int, dict]:
    rates = []
    for year in available_history_years(periods, forecast_year):
        q1_csm = periods[f"{year}-q1"]["csm"]
        remaining = sum(
            periods[f"{year}-q{quarter}"]["movement"]["adjustment"]
            for quarter in (2, 3, 4)
        )
        if q1_csm:
            rates.append({"year": year, "rate": remaining / q1_csm, "remaining": remaining})
    median_rate = statistics.median(item["rate"] for item in rates)
    current_q1_csm = periods[f"{forecast_year}-q1"]["csm"]
    return round(current_q1_csm * median_rate), {
        "method": "median historical Q2-Q4 adjustment rate to Q1 closing CSM",
        "medianRate": round(median_rate, 6),
        "observations": [
            {**item, "rate": round(item["rate"], 6)} for item in rates
        ],
    }


def estimate_model_inputs(periods: dict, forecast_year: int) -> dict:
    remaining_newbiz, newbiz_driver = estimate_remaining_newbiz(periods, forecast_year)
    remaining_adjustment, adjustment_driver = estimate_remaining_adjustment(periods, forecast_year)
    as_of_period = f"{forecast_year}-q1"
    return {
        "remainingNewbiz": remaining_newbiz,
        "remainingAdjustment": remaining_adjustment,
        "newbizShares": seasonal_shares(periods, forecast_year, "newbiz"),
        "adjustmentShares": seasonal_shares(periods, forecast_year, "adjustment"),
        "interestRate": weighted_rate(periods, "interest", as_of_period),
        "amortizationRate": weighted_rate(periods, "amortization", as_of_period),
        "drivers": {
            "newbiz": newbiz_driver,
            "adjustment": adjustment_driver,
            "rateLookbackPeriods": trailing_quarter_keys(periods, as_of_period),
        },
    }


def project(opening: int, newbiz_total: int, adjustment_total: int, newbiz_shares: list[float], adjustment_shares: list[float], interest_rate: float, amortization_rate: float) -> dict:
    current = opening
    totals = {"newbiz": 0, "interest": 0, "adjustment": 0, "amortization": 0}
    quarters = []
    for index, quarter in enumerate((2, 3, 4)):
        newbiz = round(newbiz_total * newbiz_shares[index])
        adjustment = round(adjustment_total * adjustment_shares[index])
        if index == 2:
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


def annualize(q1_movement: dict, remaining: dict) -> dict:
    """Combine disclosed Q1 actual and Q2-Q4 forecast into prior-year-end-based Movement."""
    q1 = {"period": "2026-q1", "actual": True, **q1_movement}
    annual = {
        "opening": q1_movement["opening"],
        "newbiz": q1_movement["newbiz"] + remaining["newbiz"],
        "interest": q1_movement["interest"] + remaining["interest"],
        "adjustment": q1_movement["adjustment"] + remaining["adjustment"],
        "amortization": q1_movement["amortization"] + remaining["amortization"],
        "closing": remaining["closing"],
        "quarters": [q1, *remaining["quarters"]],
        "remainingForecast": remaining,
        "movementBasis": "2025년말 기시 · 2026.1Q 실적 + 2026.2Q~4Q 전망",
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
    annual["adjustmentOverlayBasis"] = "경영목표와 독립 모델 차이를 CSM 조정 등에 포함"

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

    adjustment_rates = []
    for year in available_history_years(periods, forecast_year):
        origin_csm = periods[f"{year}-q{origin_quarter}"]["csm"]
        remaining_adjustment = sum(
            periods[f"{year}-q{quarter}"]["movement"]["adjustment"] for quarter in future_quarters
        )
        if origin_csm:
            adjustment_rates.append(remaining_adjustment / origin_csm)
    median_adjustment_rate = statistics.median(adjustment_rates)
    as_of_period = f"{forecast_year}-q{origin_quarter}"
    return {
        "remainingNewbiz": remaining_newbiz,
        "remainingAdjustment": round(periods[as_of_period]["csm"] * median_adjustment_rate),
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
            "adjustmentMedianRate": round(median_adjustment_rate, 6),
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
            "adjustmentMedianRate": inputs["drivers"]["adjustmentMedianRate"],
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
        "method": "회사별 50% + 업권별 50% 계층 보정",
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


def historical_newbiz_growth(periods: dict) -> float:
    values = [periods[f"{year}-ye"]["movement"]["newbiz"] for year in (2023, 2024, 2025)]
    growth_rates = [values[index] / values[index - 1] - 1 for index in range(1, len(values)) if values[index - 1] > 0]
    weighted = growth_rates[-1] * 0.65 + growth_rates[-2] * 0.35 if len(growth_rates) >= 2 else growth_rates[-1]
    return clamp(weighted, -0.03, 0.05)


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
    recurring_adjustment_rate: float | None = None,
) -> dict:
    growth = historical_newbiz_growth(periods)
    long_growth = clamp(growth * 0.5, -0.01, 0.02)
    base_adjustment_rate = (
        recurring_adjustment_rate
        if recurring_adjustment_rate is not None
        else base["adjustment"] / base["opening"]
    )
    calculated_base = {2026: annual_point(2026, base)}
    calculated_worst = {2026: annual_point(2026, worst)}
    base_opening = base["closing"]
    worst_opening = worst["closing"]
    base_newbiz = base["newbiz"]

    for year in tuple(CALCULATION_YEARS)[1:]:
        base_newbiz = round(base_newbiz * (1 + growth))
        base_adjustment = round(base_opening * base_adjustment_rate)
        base_projection = project_full_year(base_opening, base_newbiz, base_adjustment, interest_rate, amortization_rate)
        worst_projection = project_full_year(
            worst_opening,
            round(base_newbiz * (1 - calibration["newbizStress"])),
            deteriorate_adjustment(
                base_adjustment,
                worst_opening,
                calibration["adjustmentDownsideRateToOpening"],
            ),
            interest_rate,
            amortization_rate,
        )
        calculated_base[year] = annual_point(year, base_projection)
        calculated_worst[year] = annual_point(year, worst_projection)
        base_opening = base_projection["closing"]
        worst_opening = worst_projection["closing"]

    long_term_anchor = calculated_base[2030]

    def normalized_terminal(newbiz_growth: float, adjustment_multiplier: float) -> dict:
        opening = long_term_anchor["closing"]
        newbiz = long_term_anchor["newbiz"]
        projection = None
        for _year in range(2031, TERMINAL_YEAR + 1):
            newbiz = round(newbiz * (1 + newbiz_growth))
            adjustment = round(opening * base_adjustment_rate * adjustment_multiplier)
            projection = project_full_year(opening, newbiz, adjustment, interest_rate, amortization_rate)
            opening = projection["closing"]
        return annual_point(TERMINAL_YEAR, projection)

    lower_growth = clamp(long_growth - 0.02, -0.04, 0.01)
    upper_growth = clamp(long_growth + 0.02, 0, 0.04)
    normalized_lower = normalized_terminal(lower_growth, 1.10)
    normalized_center = normalized_terminal(long_growth, 1.00)
    normalized_upper = normalized_terminal(upper_growth, 0.90)

    terminal_base = None
    terminal_worst = None
    for year in range(2031, TERMINAL_YEAR + 1):
        base_newbiz = round(base_newbiz * (1 + long_growth))
        base_adjustment = round(base_opening * base_adjustment_rate)
        terminal_base = project_full_year(base_opening, base_newbiz, base_adjustment, interest_rate, amortization_rate)
        terminal_worst = project_full_year(
            worst_opening,
            round(base_newbiz * (1 - calibration["newbizStress"])),
            deteriorate_adjustment(
                base_adjustment,
                worst_opening,
                calibration["adjustmentDownsideRateToOpening"],
            ),
            interest_rate,
            amortization_rate,
        )
        base_opening = terminal_base["closing"]
        worst_opening = terminal_worst["closing"]

    return {
        "nearTermPeriods": [f"{year}-ye" for year in DISPLAY_YEARS],
        "terminalPeriod": f"{TERMINAL_YEAR}-ye",
        "base": [calculated_base[year] for year in DISPLAY_YEARS],
        "worst": [calculated_worst[year] for year in DISPLAY_YEARS],
        "terminal": {
            "base": annual_point(TERMINAL_YEAR, terminal_base),
            "worst": annual_point(TERMINAL_YEAR, terminal_worst),
        },
        "assumptions": {
            "newbizGrowth": round(growth, 6),
            "longTermNewbizGrowth": round(long_growth, 6),
            "baseAdjustmentRate": round(base_adjustment_rate, 6),
            "worstNewbizStress": calibration["newbizStress"],
            "worstAdjustmentDownsideRateToOpening": calibration[
                "adjustmentDownsideRateToOpening"
            ],
            "stressCalibrationQuantile": calibration["quantile"],
            "stressCalibrationSampleCount": calibration["sampleCount"],
            "longTermMethod": "2030년 Base와 Worst를 각각 앵커로 유지해 2035년 Base와 Worst를 산출",
        },
        "executiveRationale": {
            "years1to3": (
                "최근 분기 실적과 전년 계절성으로 Base를 산출하고, 증권사 근거가 있는 회사만 제한적으로 반영. "
                f"Worst는 회사별 {calibration['sampleCount']}개·업권별 {calibration.get('sectorSampleCount', 0)}개 "
                "롤링 검증 시점의 오차를 계층 보정"
            ),
            "year5": f"과거 신계약 추세를 연 {growth * 100:+.1f}% 범위로 적용하고 2026년 CSM 조정률을 유지해 2030년까지 Movement를 연결",
            "year10": f"2035년 Base는 신계약 증가율 연 {long_growth * 100:+.1f}%와 현재 CSM 조정률을 적용하고, Worst는 동일한 백테스트 스트레스 원칙을 장기 경로에 적용",
        },
        "horizonConfidence": {
            "oneYear": "제한적 검증",
            "twoToThreeYears": "모델 경로",
            "fiveYear": "시나리오",
            "tenYear": "장기 시나리오",
        },
    }


def signed_trillion(value: int) -> str:
    return f"{value / 1000:+.2f}조원"


def worst_reason(
    base_adjustment: int,
    worst_adjustment: int,
    newbiz_stress: float,
    adjustment_downside_rate: float,
) -> str:
    return (
        f"과거 Q1 시점 연말 예측 오차의 80백분위로 신계약 CSM을 Base 대비 "
        f"{newbiz_stress * 100:.1f}% 낮추고, 기시 CSM의 {adjustment_downside_rate * 100:.1f}%를 "
        f"추가 조정 부담으로 반영. 조정은 Base {signed_trillion(base_adjustment)}에서 "
        f"Worst {signed_trillion(worst_adjustment)}으로 적용."
    )


def build_generic_movement_evidence(
    company_key: str,
    company: dict,
    q1_movement: dict,
    base: dict,
    model_inputs: dict,
    direct_sources: list[dict],
    analyst_weight: float,
    interest_rate: float,
    amortization_rate: float,
) -> tuple[dict, list[dict]]:
    dart_source = company["periods"]["2026-q1"]["sourceReference"]
    dart_source_id = f"{company_key}-2026-q1-dart"
    methodology_source_id = f"{company_key}-forecast-methodology"
    evidence_sources = [
        {
            "id": dart_source_id,
            "title": f"{company['name']} {dart_source['reportName']}",
            "url": dart_source["dartUrl"],
            "type": "official_filing",
            "use": "2026년 1분기 CSM Movement 확정값",
        },
        {
            "id": methodology_source_id,
            "title": "CSM 전망 산출 방법론",
            "url": "../CSM_FORECAST_METHODOLOGY.md",
            "type": "methodology",
            "use": "계절성·이자·조정·상각 산식과 백테스트 기준",
        },
    ]

    movement_meta = {
        "newbiz": {
            "label": "신계약 CSM",
            "statement": "최근 신계약 실적과 과거 분기별 계절성을 반영해 연간 신계약 CSM을 산출",
            "rateDetail": (
                f"1분기 확정 {q1_movement['newbiz'] / 1000:+.3f}조원과 잔여 3개 분기 "
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
            "statement": "최근 경험조정과 연말 계리 가정 재점검 부담을 반영해 CSM 조정을 산출",
            "rateDetail": (
                f"최근 최대 3개년 Q2~Q4 조정률 중앙값으로 잔여 조정 "
                f"{base['remainingForecast']['adjustment'] / 1000:+.3f}조원을 산출"
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
                "headline": f"2026년 1분기 {meta['label']} {q1_movement[key] / 1000:+.3f}조원",
                "detail": "DART 분기보고서에서 파싱·검증한 2026년 1분기 확정 Movement",
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
    q1_shares = []
    for year in available_history_years(periods, 2026):
        annual_newbiz = periods[f"{year}-ye"]["movement"]["newbiz"]
        q1_newbiz = periods[f"{year}-q1"]["movement"]["newbiz"]
        if annual_newbiz:
            q1_shares.append({"year": year, "share": q1_newbiz / annual_newbiz})

    median_q1_share = statistics.median(item["share"] for item in q1_shares)
    q1_actual = periods["2026-q1"]["movement"]["newbiz"]
    q1_run_rate_total = round(q1_actual / median_q1_share)
    q1_run_rate_remaining = q1_run_rate_total - q1_actual
    statistical_remaining = model_inputs["remainingNewbiz"]

    # Positive channel/product evidence allows a bounded 40% weight on the current Q1 run-rate.
    run_rate_weight = 0.40
    p50_remaining_newbiz = round(
        statistical_remaining * (1 - run_rate_weight)
        + q1_run_rate_remaining * run_rate_weight
    )

    recurring_observations = []
    for year in available_history_years(periods, 2026):
        values = [
            periods[f"{year}-q{quarter}"]["movement"]["adjustment"]
            for quarter in (2, 3, 4)
        ]
        event_value = max(values, key=abs)
        recurring_observations.append(
            {
                "year": year,
                "q2ToQ4": sum(values),
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
            "q1Actual": q1_actual,
            "historicalQ1Shares": [
                {**item, "share": round(item["share"], 6)} for item in q1_shares
            ],
            "medianQ1Share": round(median_q1_share, 6),
            "q1RunRateRemaining": q1_run_rate_remaining,
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
    q1_movement: dict,
    opening: int,
    inputs: dict,
    model_inputs: dict,
    interest_rate: float,
    amortization_rate: float,
    calibration: dict,
    known_base_anchor: dict | None = None,
) -> dict:
    p50_newbiz = inputs["newBusiness"]["p50Remaining"]
    p50_adjustment = inputs["adjustment"]["p50Remaining"]
    newbiz_error = calibration["newbizStress"]
    adjustment_error = calibration["adjustmentDownsideRateToOpening"]
    adjustment_span = round(opening * adjustment_error)

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
        annual = annualize(q1_movement, remaining)
        annual.update({"label": label, "description": description})
        return annual

    model_p10 = scenario(
        round(p50_newbiz * (1 - newbiz_error)),
        p50_adjustment - adjustment_span,
        "Worst",
        "신계약 판매가 예상보다 둔화되고 장래손해율·해지·비용 가정 악화로 CSM 조정 부담까지 함께 커지는 경우",
    )
    model_p50 = scenario(
        p50_newbiz,
        p50_adjustment,
        "Base",
        "1분기 판매 호조를 일부 이어가되 과도하게 연장하지 않은 Base 경로",
    )
    stresses = {
        "salesSlowdown": scenario(
            round(p50_newbiz * (1 - newbiz_error)),
            p50_adjustment,
            "판매 둔화",
            "판매량 또는 상품 수익성이 예상보다 낮아 신계약 CSM 창출력이 약해지는 경우",
        ),
        "marginCompression": scenario(
            round(p50_newbiz * (1 - newbiz_error / 2)),
            p50_adjustment,
            "수익성 압박",
            "판매 규모는 유지되지만 상품 믹스와 마진이 나빠져 계약당 CSM이 낮아지는 경우",
        ),
        "lapseAndExpense": scenario(
            p50_newbiz,
            p50_adjustment - adjustment_span,
            "장래손해율·해지·비용 부담",
            "판매는 계획대로 진행되지만 장래손해율 상승, 해지 증가 또는 사업비 가정 악화로 CSM 조정 부담이 커지는 경우",
        ),
        "combined": scenario(
            round(p50_newbiz * (1 - newbiz_error)),
            p50_adjustment - adjustment_span,
            "복합 스트레스",
            "신계약 CSM 창출력 약화와 장래손해율·해지·비용 가정 악화가 동시에 발생하는 Worst 복합 경로",
        ),
    }

    p10 = deepcopy(model_p10)
    p50 = deepcopy(model_p50)
    anchor_reconciliation = 0
    if known_base_anchor:
        anchor_reconciliation = known_base_anchor["value"] - model_p50["closing"]
        reconcile_annual_to_anchor(p50, known_base_anchor["value"])
        reconcile_annual_to_anchor(p10, model_p10["closing"] + anchor_reconciliation)
        for stress in stresses.values():
            reconcile_annual_to_anchor(stress, stress["closing"] + anchor_reconciliation)

    movement_evidence = {
        "newbiz": {
            "statement": "1분기 건강보험 중심 판매 호조와 FC 채널 확대를 반영하되 연중 과도한 연율화는 제한",
            "items": [
                {
                    "kind": "actual",
                    "label": "확정 실적",
                    "headline": f"2026년 1분기 신계약 CSM {q1_movement['newbiz'] / 1000:.3f}조원",
                    "detail": "분기보고서 기준 확정 Movement이며, 실적발표에서는 전분기 대비 11% 증가로 설명",
                    "sourceId": "samsung-2026-q1-dart",
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
                    "headline": f"잔여 3개 분기 {p50_newbiz / 1000:.3f}조원",
                    "detail": (
                        f"과거 계절성 잔여 전망 {inputs['newBusiness']['statisticalRemaining'] / 1000:.3f}조원 60%와 "
                        f"1분기 런레이트 잔여 전망 {inputs['newBusiness']['q1RunRateRemaining'] / 1000:.3f}조원 40%를 결합. "
                        f"1분기 확정치를 더한 연간 신계약 CSM은 {p50['newbiz'] / 1000:.3f}조원"
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
                    "headline": f"2026년 1분기 이자부리 {q1_movement['interest'] / 1000:+.3f}조원",
                    "detail": "DART 분기보고서에서 파싱·검증한 1분기 누적 CSM Movement",
                    "sourceId": "samsung-2026-q1-dart",
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
                    f". 참고: {known_base_anchor['value'] / 1000:.1f}조원 목표 정합화를 위한 "
                    f"{anchor_reconciliation / 1000:+.2f}조원을 CSM 조정 등에 포함"
                    if known_base_anchor
                    else ""
                )
            ),
            "items": [
                {
                    "kind": "actual",
                    "label": "확정 실적",
                    "headline": f"2026년 1분기 CSM 조정 {q1_movement['adjustment'] / 1000:+.3f}조원",
                    "detail": "DART 분기보고서 기준 확정 Movement. 연간 Base는 1분기 확정치를 변경하지 않음",
                    "sourceId": "samsung-2026-q1-dart",
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
                            f"으로 구분. 여기에 {known_base_anchor['value'] / 1000:.1f}조원 목표 정합화를 위한 "
                            f"{anchor_reconciliation / 1000:+.3f}조원을 추가해 연간 CSM 조정 등에 포함"
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
                    "headline": f"2026년 1분기 CSM 상각 {q1_movement['amortization'] / 1000:+.3f}조원",
                    "detail": "DART 분기보고서 기준 보험서비스 제공에 따라 손익으로 인식된 확정 CSM Movement",
                    "sourceId": "samsung-2026-q1-dart",
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
        "modelVersion": "samsung-driver-ensemble/v2",
        "status": "pilot",
        "asOfPeriod": "2026-q1",
        "targetPeriod": "2026-ye",
        "interval": {
            "type": "company-sector hierarchical rolling error scenario",
            "coverage": 0.80,
            "sampleCount": calibration["sampleCount"],
            "sectorSampleCount": calibration.get("sectorSampleCount"),
            "companyBacktestSamples": calibration["sampleCount"],
            "interpretation": "Base는 경영입력 또는 모델 경로이며 Worst는 회사·업권 오차를 반영한 하방 시나리오로 확률적 최악값이 아님",
        },
        "distribution": {"p10": p10, "p50": p50},
        "independentModel": {"base": model_p50, "worst": model_p10},
        "newBusinessBridge": inputs["newBusiness"],
        "serviceRelease": {
            "method": "최근 4개 분기 coverage-unit 서비스 제공률 대용치",
            "rate": round(amortization_rate, 6),
            "denominator": "기시 CSM + 신계약 CSM",
            "lookbackPeriods": model_inputs["drivers"]["rateLookbackPeriods"],
            "q1ActualAmortization": q1_movement["amortization"],
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
                "application": "2026년 Base의 CSM 조정 등에 목표 정합화 차이를 포함; 2027년 이후 정상화 Movement 재개",
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
        opening = round(periods["2026-q1"]["csm"])
        q1_movement = periods["2026-q1"]["movement"]
        model_inputs = estimate_model_inputs(periods, 2026)
        interest_rate = config.get("interest_rate_override") or model_inputs["interestRate"]
        amortization_rate = model_inputs["amortizationRate"]
        analyst_weight = ANALYST_OVERLAY_WEIGHT if config["sources"] else 0
        model_weight = 1 - analyst_weight
        base_newbiz = round(
            model_inputs["remainingNewbiz"] * model_weight
            + config["base_newbiz"] * analyst_weight
        )
        base_adjustment = round(
            model_inputs["remainingAdjustment"] * model_weight
            + config["base_adjustment"] * analyst_weight
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
        worst_newbiz = round(base_newbiz * (1 - calibration["newbizStress"]))
        worst_adjustment = deteriorate_adjustment(
            base_adjustment,
            opening,
            calibration["adjustmentDownsideRateToOpening"],
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
        base = annualize(q1_movement, base_remaining)
        worst = annualize(q1_movement, worst_remaining)
        recurring_adjustment_rate = base["adjustment"] / base["opening"]
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
            reconcile_annual_to_anchor(
                worst,
                worst["closing"] + anchor_reconciliation,
            )
        overlay_note = (
            f" 증권사 근거가 있는 정성 입력을 {analyst_weight * 100:.0f}% 오버레이."
            if analyst_weight
            else " 회사별 직접 근거가 없어 정성 오버레이는 0%."
        )
        base_rationale = (
            "전년 동분기 계절성, Q1 성장 신호, 최근 3개년 조정률 중앙값과 최근 4개 분기 "
            f"이자·상각률로 산출.{overlay_note}"
        )
        if known_base_anchor:
            base_rationale = (
                f"사용자 제공 2026년말 CSM 목표 {known_base_anchor['value'] / 1000:.1f}조원을 경영계획 Base로 적용. "
                f"독립 모델 {model_generated_base_closing / 1000:.3f}조원과의 차이 "
                f"{anchor_reconciliation / 1000:+.3f}조원을 CSM 조정 등에 포함."
            )
        base.update({"rationale": base_rationale})
        worst_rationale = worst_reason(
            base_adjustment,
            worst_adjustment,
            calibration["newbizStress"],
            calibration["adjustmentDownsideRateToOpening"],
        )
        worst.update({"rationale": worst_rationale})
        horizon = build_horizon(
            periods,
            base,
            worst,
            interest_rate,
            amortization_rate,
            calibration,
            recurring_adjustment_rate,
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
            q1_movement,
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
                "note": "사용자 제공 목표를 경영계획 Base로 사용 · 모델 차이는 CSM 조정 등에 포함",
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
            "asOfPeriod": "2026-q1",
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
                "version": "rolling-origin-seasonal/v2",
                "baseline": {
                    "remainingNewbiz": model_inputs["remainingNewbiz"],
                    "remainingAdjustment": model_inputs["remainingAdjustment"],
                    "newbizShares": [round(value, 6) for value in model_inputs["newbizShares"]],
                    "adjustmentShares": [round(value, 6) for value in model_inputs["adjustmentShares"]],
                    "drivers": model_inputs["drivers"],
                },
                "analystOverlay": {
                    "weight": analyst_weight,
                    "remainingNewbiz": config["base_newbiz"] if analyst_weight else None,
                    "remainingAdjustment": config["base_adjustment"] if analyst_weight else None,
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
                        f"과 애널리스트 판단 {config['base_newbiz'] / 1000:.2f}조원을 "
                        f"{analyst_weight * 100:.0f}% 가중해 {base_newbiz / 1000:.2f}조원 적용."
                        if analyst_weight
                        else f"을 그대로 적용. {model_inputs['drivers']['newbiz']['appliedGrowthSignal'] * 100:+.1f}% 성장 신호 반영."
                    )
                ),
                "baseAdjustment": (
                    f"최근 최대 3개년 Q2~Q4 조정률 중앙값 기반 {model_inputs['remainingAdjustment'] / 1000:+.2f}조원"
                    + (
                        f"에 애널리스트 판단을 {analyst_weight * 100:.0f}% 가중해 {base_adjustment / 1000:+.2f}조원 적용."
                        if analyst_weight
                        else "을 그대로 적용."
                    )
                ),
                "targetAdjustmentOverlay": (
                    f"경영계획 Base {known_base_anchor['value'] / 1000:.2f}조원과 독립 모델 "
                    f"{model_generated_base_closing / 1000:.2f}조원의 차이 {anchor_reconciliation / 1000:+.2f}조원. "
                    "CSM 조정 등에 포함."
                    if known_base_anchor
                    else "목표 정합화 조정 없음"
                ),
                "worst": worst_rationale,
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
                q1_movement,
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
            forecast_entry["model"]["version"] = "samsung-driver-ensemble/v2"
            forecast_entry["model"]["finalInputs"] = {
                "remainingNewbiz": base_newbiz,
                "remainingAdjustment": base_adjustment,
            }
            forecast_entry["qualitativeJudgment"]["baseNewbiz"] = (
                f"1분기 신계약 CSM 호조를 연중 흐름에 일부 반영하되, 이를 그대로 연율화하지 않고 "
                f"과거 분기별 판매 패턴과 함께 적용해 남은 3개 분기 {base_newbiz / 1000:.2f}조원으로 전망."
            )
            forecast_entry["qualitativeJudgment"]["baseAdjustment"] = (
                f"통상적인 경험조정과 연말 계리 가정 재점검 부담을 구분해 반영. "
                f"현재 해지 흐름이 안정화된 점을 감안하되 연말 변동 가능성을 남겨 잔여 모델 조정 {base_adjustment / 1000:+.2f}조원 적용. "
                + (
                    f"참고: {known_base_anchor['value'] / 1000:.1f}조원 목표 정합화를 위한 "
                    f"{anchor_reconciliation / 1000:+.2f}조원을 CSM 조정 등에 포함."
                    if known_base_anchor
                    else ""
                )
            )
            forecast_entry["base"]["rationale"] = (
                f"사용자 제공 2026년말 CSM 목표 {known_base_anchor['value'] / 1000:.1f}조원을 경영계획 Base로 적용했습니다. "
                f"독립 Driver 모델 대비 {anchor_reconciliation / 1000:+.3f}조원 차이를 CSM 조정 등에 포함했습니다."
                if known_base_anchor
                else (
                    "1분기 신계약 호조가 연중 일부 이어지는 것으로 보되 과도한 연율화는 피했습니다. "
                    "보험서비스 제공에 따른 CSM 인식과 연말 계리 가정 재점검 부담까지 반영한 Base입니다."
                )
            )
            samsung_downside_rationale = (
                "신계약 판매 둔화와 계약당 수익성 저하가 나타나고, 해지·비용 관련 CSM 조정 부담도 "
                "함께 커지는 경우를 반영한 Worst입니다. CSM 조정 부담에는 장래손해율 상승, 해지 증가 및 사업비 가정 악화를 포함하며, "
                "1분기 확정 실적은 낮추지 않았습니다."
            )
            forecast_entry["worst"]["rationale"] = samsung_downside_rationale
            forecast_entry["qualitativeJudgment"]["worst"] = samsung_downside_rationale
            forecast_entry["horizon"]["executiveRationale"]["years1to3"] = (
                "2026년은 사용자 제공 CSM 목표 13.5조원을 경영계획 Base로 적용하고 독립 모델 전망을 병렬 공개. "
                "Worst는 같은 목표를 출발점으로 신계약 판매 둔화와 장래손해율·해지·비용 가정 악화에 따른 CSM 조정 부담을 반영하고, 2027~2028년은 정상화 Movement로 계산"
                if known_base_anchor
                else (
                    "2026년은 현재 판매 흐름과 CSM 인식·조정 부담을 반영한 Base로 산출. "
                    "Worst는 신계약 판매 둔화와 장래손해율·해지·비용 가정 악화에 따른 CSM 조정 부담을 함께 반영하고, 2027~2028년은 같은 사업 흐름을 이어 계산"
                )
            )
        forecasts[company_key] = forecast_entry
    return {
        "version": "2026.08.16-v7.3",
        "generatedAt": "2026-08-15",
        "asOfPeriod": "2026-q1",
        "targetPeriod": "2026-ye",
        "nearTermPeriods": [f"{year}-ye" for year in DISPLAY_YEARS],
        "terminalPeriod": f"{TERMINAL_YEAR}-ye",
        "unit": "KRW billion",
        "status": "decision-support scenario; not company guidance",
        "methodologyDocument": "../CSM_FORECAST_METHODOLOGY.md",
        "methodology": {
            "model": "rolling-origin-seasonal/v2 + samsung-driver-ensemble/v2",
            "base": "independent model view with separately disclosed management-case reconciliation",
            "stress": "company-sector hierarchical rolling-backtest error percentile",
            "analystOverlayWeight": ANALYST_OVERLAY_WEIGHT,
            "driverPilot": "Samsung Life driver scenario ensemble",
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
