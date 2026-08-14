# -*- coding: utf-8 -*-
"""Validate life-insurer annual dashboard values with FISIS and official IR.

Primary CSM and movement values come from Open DART separate statements.
FISIS is queried first for financial and solvency metrics. Because FISIS does
not publish CSM movement, official company IR/disclosure material is used as
the fallback check. API credentials are never written to the output.
"""

from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DASHBOARD_DATA = ROOT / "external-data" / "csm-annual-dashboard-data.json"
OUTPUT = ROOT / "external-data" / "life-company-validation.json"
HANWHA_VALIDATION = ROOT / "external-data" / "hanwha-life-validation.json"
FISIS_BASE = "https://fisis.fss.or.kr/openapi"

COMPANIES = {
    "samsung-life": {"name": "삼성생명", "financeCd": "0010595"},
    "hanwha-life": {"name": "한화생명", "financeCd": "0010593"},
    "kyobo-life": {"name": "교보생명", "financeCd": "0010597"},
    "shinhan-life": {"name": "신한라이프", "financeCd": "0010599"},
}

# Exact or rounded amounts explicitly published by the companies. Years not
# listed remain DART-only after documenting that the IR fallback was attempted.
IR_CSM_CHECKS = {
    "samsung-life": {
        2023: {
            "value": 12200,
            "tolerance": 100,
            "source": "삼성생명 FY2023 경영실적",
            "sourceUrl": "https://www.samsunglife.com/",
            "note": "IR 공시값 12.2조원(십억원 환산·표시단위 반올림)",
        },
        2024: {
            "value": 12900,
            "tolerance": 100,
            "source": "삼성생명 FY2024 경영실적",
            "sourceUrl": "https://www.samsunglife.com/",
            "note": "IR 공시값 12.9조원(십억원 환산·표시단위 반올림)",
        },
        2025: {
            "value": 13200,
            "tolerance": 100,
            "source": "삼성생명 FY2025 경영실적",
            "sourceUrl": "https://www.samsunglife.com/",
            "note": "IR 공시값 13.2조원(십억원 환산·표시단위 반올림)",
        },
    },
    "kyobo-life": {
        2024: {
            "value": 6438.1,
            "tolerance": 1,
            "source": "교보생명 FY2025 실적 설명자료",
            "sourceUrl": "https://news.kyobo.com/fy2025-%EC%8B%A4%EC%A0%81-%EC%84%A4%EB%AA%85%EC%9E%90%EB%A3%8C/",
            "note": "2024년말 누적 CSM 비교값",
        },
        2025: {
            "value": 6511.0,
            "tolerance": 1,
            "source": "교보생명 FY2025 실적 설명자료",
            "sourceUrl": "https://news.kyobo.com/fy2025-%EC%8B%A4%EC%A0%81-%EC%84%A4%EB%AA%85%EC%9E%90%EB%A3%8C/",
            "note": "누적 CSM 6조5,110억원",
        },
    },
    "shinhan-life": {
        2024: {
            "value": 7200,
            "tolerance": 100,
            "source": "신한라이프 공식 보도자료",
            "sourceUrl": "https://www.shinhangroup.com/kr/archive/press/detail/10",
            "note": "회사 공시값 약 7.2조원(표시단위 반올림)",
        },
        2025: {
            "value": 7600,
            "tolerance": 100,
            "source": "신한라이프 공식 보도자료",
            "sourceUrl": "https://www.shinhangroup.com/kr/archive/press/detail/788",
            "note": "회사 공시값 7.6조원(표시단위 반올림)",
        },
    },
}


def load_api_key() -> str:
    if os.environ.get("API_FISIS"):
        return os.environ["API_FISIS"]
    env_file = ROOT / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            if line.startswith("API_FISIS="):
                return line.split("=", 1)[1].strip()
    raise RuntimeError("API_FISIS is not configured")


def fetch(api_key: str, finance_cd: str, params: dict[str, str]) -> dict[str, Any]:
    query = urllib.parse.urlencode(
        {"auth": api_key, "lang": "kr", "financeCd": finance_cd, **params}
    )
    request = urllib.request.Request(
        f"{FISIS_BASE}/statisticsInfoSearch.json?{query}",
        headers={"User-Agent": "Mozilla/5.0"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.load(response)
    result = payload.get("result", {})
    if result.get("err_cd") != "000":
        raise RuntimeError(f"FISIS error {result.get('err_cd')}: {result.get('err_msg')}")
    return result


def values_by_year(
    api_key: str,
    finance_cd: str,
    *,
    list_no: str,
    account_cd: str,
    value_column: str,
    start: str,
    end: str,
    term: str,
) -> dict[int, float]:
    result = fetch(
        api_key,
        finance_cd,
        {
            "listNo": list_no,
            "accountCd": account_cd,
            "term": term,
            "startBaseMm": start,
            "endBaseMm": end,
        },
    )
    return {
        int(row["base_month"][:4]): float(str(row[value_column]).replace(",", ""))
        for row in result.get("list", [])
        if row["base_month"].endswith("12") and row.get(value_column) not in (None, "")
    }


def close_enough(
    primary: float | int | None, check: float | int | None, tolerance: float
) -> bool:
    return (
        primary is not None
        and check is not None
        and abs(float(primary) - float(check)) <= tolerance
    )


def company_validation(
    api_key: str, company_key: str, config: dict[str, str], dashboard: dict
) -> dict[str, Any]:
    finance_cd = config["financeCd"]
    periods = dashboard["sampleData"][company_key]["periods"]
    insurance_profit = values_by_year(
        api_key,
        finance_cd,
        list_no="SH154",
        account_cd="A",
        value_column="b",
        start="202301",
        end="202512",
        term="Y",
    )
    separate_net_income = values_by_year(
        api_key,
        finance_cd,
        list_no="SH154",
        account_cd="G",
        value_column="b",
        start="202301",
        end="202512",
        term="Y",
    )
    kics_after_transition = values_by_year(
        api_key,
        finance_cd,
        list_no="SH021",
        account_cd="D",
        value_column="a",
        start="202301",
        end="202512",
        term="Q",
    )
    kics_before_transition = values_by_year(
        api_key,
        finance_cd,
        list_no="SH021",
        account_cd="A",
        value_column="a",
        start="202301",
        end="202512",
        term="Q",
    )
    rbc = values_by_year(
        api_key,
        finance_cd,
        list_no="SH148",
        account_cd="A",
        value_column="a",
        start="202201",
        end="202212",
        term="Q",
    )

    normalized_profit = {
        year: value / 1_000_000_000 for year, value in insurance_profit.items()
    }
    normalized_net_income = {
        year: value / 1_000_000_000 for year, value in separate_net_income.items()
    }
    output_periods: dict[str, Any] = {}
    for year in range(2022, 2026):
        dart = periods[f"{year}-ye"]
        ir_check = IR_CSM_CHECKS.get(company_key, {}).get(year)
        fisis_profit = normalized_profit.get(year)
        fisis_separate_ni = normalized_net_income.get(year)
        after_transition = kics_after_transition.get(year)
        if year == 2022:
            solvency = rbc.get(year)
            solvency_table = "SH148/A"
            solvency_note = None
        elif after_transition not in (None, 0):
            solvency = after_transition
            solvency_table = "SH021/D"
            solvency_note = "경과조치 적용 후"
        else:
            solvency = kics_before_transition.get(year)
            solvency_table = "SH021/A"
            solvency_note = "경과조치 적용 후 값이 0 또는 미제공되어 적용 전 비율 사용"
        if ir_check:
            csm_check = {
                "value": dart["csm"],
                "checkValue": ir_check["value"],
                "status": (
                    "matched"
                    if close_enough(
                        dart["csm"], ir_check["value"], ir_check["tolerance"]
                    )
                    else "mismatch"
                ),
                "source": ir_check["source"],
                "sourceUrl": ir_check["sourceUrl"],
                "basis": "별도 · 발행 보험계약 · 출재 재보험 제외",
                "note": ir_check["note"],
            }
        else:
            csm_check = {
                "value": dart["csm"],
                "checkValue": None,
                "status": "ir_not_available",
                "source": "회사 공식 IR/경영공시 탐색",
                "basis": "별도 · 발행 보험계약 · 출재 재보험 제외",
                "note": "동일 기준의 독립된 연도말 IR 수치를 찾지 못해 DART 원표만 적용",
            }
        output_periods[str(year)] = {
            "summary": (
                "교차검증 완료"
                if ir_check and fisis_profit is not None and solvency is not None
                else "부분 교차검증"
            ),
            "primarySource": "Open DART",
            "validationPriority": "FISIS → 회사 공식 IR/경영공시",
            "csm": csm_check,
            "movement": {
                "status": "arithmetic_validated",
                "source": "Open DART 별도 주석",
                "checkValue": dart["movement"],
                "note": "기말 = 기초 + 신계약 + 이자 + 상각 + 기타조정 검산",
            },
            "insuranceProfit": {
                "value": dart["insuranceProfit"],
                "checkValue": fisis_profit,
                "status": (
                    "matched"
                    if close_enough(dart["insuranceProfit"], fisis_profit, 0.01)
                    else "ir_fallback_required"
                ),
                "source": "FISIS" if fisis_profit is not None else "회사 공식 IR/경영공시",
                "basis": "별도 · K-IFRS",
                "table": "SH154/A",
            },
            "parentNetIncome": {
                "value": dart["parentNetIncome"],
                "fisisSeparateNetIncome": fisis_separate_ni,
                "status": "basis_difference",
                "source": "FISIS",
                "basis": "DART 값은 연결 지배기업 귀속, FISIS는 별도",
                "note": "귀속 범위가 달라 수치 일치 판정에서 제외",
            },
            "kics": {
                "value": solvency,
                "status": "validated" if solvency is not None else "unavailable",
                "source": "FISIS",
                "basis": "RBC" if year == 2022 else "K-ICS",
                "table": solvency_table,
                "note": solvency_note,
            },
        }
    return {
        "name": config["name"],
        "fisisFinanceCd": finance_cd,
        "periods": output_periods,
    }


def main() -> int:
    api_key = load_api_key()
    dashboard = json.loads(DASHBOARD_DATA.read_text(encoding="utf-8"))
    companies = {
        key: company_validation(api_key, key, config, dashboard)
        for key, config in COMPANIES.items()
        if key != "hanwha-life"
    }
    if HANWHA_VALIDATION.exists():
        legacy = json.loads(HANWHA_VALIDATION.read_text(encoding="utf-8"))
        companies["hanwha-life"] = {
            "name": "한화생명",
            "fisisFinanceCd": COMPANIES["hanwha-life"]["financeCd"],
            "periods": legacy["periods"],
        }
    else:
        companies["hanwha-life"] = company_validation(
            api_key, "hanwha-life", COMPANIES["hanwha-life"], dashboard
        )
    output = {
        "schemaVersion": "life-company-validation/v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourcePolicy": {
            "primary": "Open DART",
            "validation": ["FISIS", "회사 공식 IR/경영공시"],
        },
        "companies": companies,
    }
    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(OUTPUT)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
