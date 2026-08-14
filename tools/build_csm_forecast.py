# -*- coding: utf-8 -*-
"""Build explainable near- and long-term CSM forecasts for the nine-company dashboard."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "external-data" / "csm-quarterly-dashboard-data.json"
OUTPUT_JSON = ROOT / "external-data" / "csm-forecast-2026.json"
OUTPUT_JS = ROOT / "csm-prototype" / "forecast-data.generated.js"

LOOKBACK_PERIODS = ["2025-q2", "2025-q3", "2025-q4", "2026-q1"]
LOOKBACK_WEIGHTS = [0.10, 0.20, 0.30, 0.40]
ADJUSTMENT_SHARES = [0.20, 0.20, 0.60]
WORST_STRESS = 0.20
CALCULATION_YEARS = range(2026, 2031)
DISPLAY_YEARS = (2026, 2027, 2028, 2030)
TERMINAL_YEAR = 2035

GENERAL_SOURCES = [
    {
        "title": "삼성증권 보험업 이슈 브리프 (2026.01.05)",
        "url": "https://www.samsungpop.com/common.do?cmd=down&contentType=application%2Fpdf&fileName=2020%2F2026010509115239K_02_03.pdf&inlineYn=Y&saveKey=research.pdf",
        "type": "sell_side",
        "use": "보험업 신계약·손해율 방향을 Base 정성 보정에만 참고",
    },
]

CONFIG = {
    "samsung-life": {
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
        "base_newbiz_reason": "1분기 신계약 CSM과 최근 분기 계절성을 반영해 잔여 신계약을 전년 수준보다 보수적인 2.15조원으로 설정.",
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
        "base_newbiz_reason": "1분기 보장성 신계약 매출과 신계약 CSM 감소세를 반영해 잔여 신계약 2.20조원으로 보수적으로 설정.",
        "base_adjustment_reason": "최근 연말 대규모 조정 이력과 1분기 정상화를 함께 반영해 잔여 조정 -1.20조원 적용.",
        "sources": [{"title": "DB손해보험 1Q26 증권사 리포트", "url": "https://file.alphasquare.co.kr/media/pdfs/company-report/_260518%20DB%EC%86%90%ED%95%B4%EB%B3%B4%ED%97%98_%EC%A0%84%EB%B0%B0%EC%8A%B9_912_Online%20report%20_%206_10p_DB%EC%86%90%ED%95%B4%EB%B3%B4%ED%97%98.pdf", "type": "sell_side", "use": "보장성 매출 20%·신계약 CSM 12% 감소 전망을 Base/Worst에 반영"}],
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


def weighted_rate(periods: dict, key: str) -> float:
    values = []
    for period_key, weight in zip(LOOKBACK_PERIODS, LOOKBACK_WEIGHTS):
        movement = periods[period_key]["movement"]
        exposure = movement["opening"] + movement["newbiz"]
        numerator = movement[key] if key == "interest" else -movement[key]
        values.append(weight * numerator / exposure)
    return sum(values)


def remaining_newbiz_shares(periods: dict) -> list[float]:
    values = [periods[f"2025-q{quarter}"]["movement"]["newbiz"] for quarter in (2, 3, 4)]
    total = sum(values)
    return [value / total for value in values]


def project(opening: int, newbiz_total: int, adjustment_total: int, newbiz_shares: list[float], interest_rate: float, amortization_rate: float) -> dict:
    current = opening
    totals = {"newbiz": 0, "interest": 0, "adjustment": 0, "amortization": 0}
    quarters = []
    for index, quarter in enumerate((2, 3, 4)):
        newbiz = round(newbiz_total * newbiz_shares[index])
        adjustment = round(adjustment_total * ADJUSTMENT_SHARES[index])
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


def clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def deteriorate_adjustment(base_adjustment: int) -> int:
    """Apply one consistent 20% downside stress to favorable or unfavorable adjustment."""
    factor = 1 + WORST_STRESS if base_adjustment < 0 else 1 - WORST_STRESS
    return round(base_adjustment * factor)


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
    return {"period": f"{year}-ye", **{key: projection[key] for key in ("opening", "newbiz", "interest", "adjustment", "amortization", "closing")}}


def build_horizon(periods: dict, base: dict, worst: dict, interest_rate: float, amortization_rate: float) -> dict:
    growth = historical_newbiz_growth(periods)
    long_growth = clamp(growth * 0.5, -0.01, 0.02)
    base_adjustment_rate = base["adjustment"] / base["opening"]
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
            round(base_newbiz * (1 - WORST_STRESS)),
            deteriorate_adjustment(base_adjustment),
            interest_rate,
            amortization_rate,
        )
        calculated_base[year] = annual_point(year, base_projection)
        calculated_worst[year] = annual_point(year, worst_projection)
        base_opening = base_projection["closing"]
        worst_opening = worst_projection["closing"]

    terminal_base = None
    terminal_worst = None
    for year in range(2031, TERMINAL_YEAR + 1):
        base_newbiz = round(base_newbiz * (1 + long_growth))
        base_adjustment = round(base_opening * base_adjustment_rate)
        terminal_base = project_full_year(base_opening, base_newbiz, base_adjustment, interest_rate, amortization_rate)
        terminal_worst = project_full_year(
            worst_opening,
            round(base_newbiz * (1 - WORST_STRESS)),
            deteriorate_adjustment(base_adjustment),
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
            "worstNewbizStress": WORST_STRESS,
            "worstAdjustmentStress": WORST_STRESS,
            "longTermMethod": "2031~2035년은 2026~2030년 추세를 절반 수준으로 수렴시켜 내부 연도별 계산 후 2035년말만 표시",
        },
        "executiveRationale": {
            "years1to3": "최근 분기 실적·계절성과 증권사 애널리스트 방향성을 반영해 2026~2028년 Base를 산출하고, Worst는 신계약·조정을 각각 20% 악화",
            "year5": f"과거 신계약 추세를 연 {growth * 100:+.1f}% 범위로 적용하고 2026년 CSM 조정률을 유지해 2030년까지 Movement를 연결",
            "year10": f"2031~2035년 신계약 증가율을 연 {long_growth * 100:+.1f}%로 수렴시키고 중간 연도를 누적 계산해 2035년 종착점 산출",
        },
    }


def signed_trillion(value: int) -> str:
    return f"{value / 1000:+.2f}조원"


def worst_reason(base_adjustment: int, worst_adjustment: int) -> str:
    return (
        "전망 구간의 신계약 CSM과 CSM 조정을 Base 대비 각각 20% 악화. "
        f"조정은 Base {signed_trillion(base_adjustment)}에서 Worst {signed_trillion(worst_adjustment)}으로 적용."
    )


def build() -> dict:
    source = json.loads(SOURCE.read_text(encoding="utf-8"))["sampleData"]
    forecasts = {}
    for company_key, config in CONFIG.items():
        company = source[company_key]
        periods = company["periods"]
        opening = round(periods["2026-q1"]["csm"])
        q1_movement = periods["2026-q1"]["movement"]
        interest_rate = config.get("interest_rate_override") or weighted_rate(periods, "interest")
        amortization_rate = weighted_rate(periods, "amortization")
        shares = remaining_newbiz_shares(periods)
        base_remaining = project(opening, config["base_newbiz"], config["base_adjustment"], shares, interest_rate, amortization_rate)
        worst_newbiz = round(config["base_newbiz"] * (1 - WORST_STRESS))
        worst_adjustment = deteriorate_adjustment(config["base_adjustment"])
        worst_remaining = project(opening, worst_newbiz, worst_adjustment, shares, interest_rate, amortization_rate)
        base = annualize(q1_movement, base_remaining)
        worst = annualize(q1_movement, worst_remaining)
        base.update({"rationale": config["base_newbiz_reason"] + " " + config["base_adjustment_reason"]})
        worst_rationale = worst_reason(config["base_adjustment"], worst_adjustment)
        worst.update({"rationale": worst_rationale})
        horizon = build_horizon(periods, base, worst, interest_rate, amortization_rate)
        sources = config["sources"] + GENERAL_SOURCES
        if not sources or any(source["type"] != "sell_side" for source in sources):
            raise ValueError(f"{company_key}: forecast sources must be securities analyst reports only")
        forecasts[company_key] = {
            "companyName": company["name"],
            "asOfPeriod": "2026-q1",
            "asOfCsm": opening,
            "targetPeriod": "2026-ye",
            "anchor": {"type": "model_generated", "value": base["closing"], "note": "담당자 입력값 없음 · 모델 Base를 사용"},
            "ratios": {
                "interestRate": round(interest_rate, 6),
                "amortizationRate": round(amortization_rate, 6),
                "denominator": "기시 CSM + 신계약 CSM",
                "lookbackPeriods": LOOKBACK_PERIODS,
                "lookbackWeights": LOOKBACK_WEIGHTS,
                "interestOverride": company_key == "kyobo-life",
            },
            "base": base,
            "worst": worst,
            "horizon": horizon,
            "qualitativeJudgment": {
                "baseNewbiz": config["base_newbiz_reason"],
                "baseAdjustment": config["base_adjustment_reason"],
                "worst": worst_rationale,
            },
            "confidence": config["confidence"],
            "sources": sources,
        }
    return {
        "version": "2026.08.05-v4",
        "generatedAt": "2026-08-05",
        "asOfPeriod": "2026-q1",
        "targetPeriod": "2026-ye",
        "nearTermPeriods": [f"{year}-ye" for year in DISPLAY_YEARS],
        "terminalPeriod": f"{TERMINAL_YEAR}-ye",
        "unit": "KRW billion",
        "status": "decision-support scenario; not company guidance",
        "methodologyDocument": "../CSM_FORECAST_METHODOLOGY.md",
        "forecasts": forecasts,
    }


if __name__ == "__main__":
    payload = build()
    OUTPUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    OUTPUT_JS.write_text("window.CSM_FORECAST_DATA = " + json.dumps(payload, ensure_ascii=False, indent=2) + ";\n", encoding="utf-8")
    print(f"wrote {OUTPUT_JSON}")
    print(f"wrote {OUTPUT_JS}")
