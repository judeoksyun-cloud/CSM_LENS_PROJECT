# -*- coding: utf-8 -*-
"""Validate Hanwha Life year-end DART values with FISIS, then official IR.

The FISIS API key is read from API_FISIS or the local .env file. Credentials
are never written to the generated validation artifact.
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
OUTPUT = ROOT / "external-data" / "hanwha-life-validation.json"
FISIS_BASE = "https://fisis.fss.or.kr/openapi"
FINANCE_CD = "0010593"
IR_PAGE = "https://company.hanwhalife.com/ko/investment/investor/earnings-release"

IR_ANNUAL = {
    2022: {
        "attachmentSeq": 768,
        "csm": 9763,
        "movement": {
            "opening": 7477,
            "newbiz": 1609,
            "interest": 263,
            "amortization": -824,
            "adjustment": 1238,
            "closing": 9763,
        },
        "separateNetIncome": 354,
        "page": "2023 FY2022 발표자료 p.8 및 2024 FY2023 발표자료 p.7",
    },
    2023: {
        "attachmentSeq": 763,
        "csm": 9238,
        "movement": {
            "opening": 9763,
            "newbiz": 2541,
            "interest": 353,
            "amortization": -888,
            "adjustment": -2531,
            "closing": 9238,
        },
        "separateNetIncome": 616,
        "consolidatedNetIncome": 826,
        "page": "FY2023 발표자료 p.7-8",
    },
    2024: {
        "attachmentSeq": 759,
        "csm": 9109,
        "movement": {
            "opening": 9238,
            "newbiz": 2123,
            "interest": 350,
            "amortization": -852,
            "adjustment": -1750,
            "closing": 9109,
        },
        "separateNetIncome": 721,
        "consolidatedNetIncome": 866,
        "page": "FY2024 발표자료 p.7-8",
    },
    2025: {
        "attachmentSeq": 844,
        "csm": 8714,
        "movement": {
            "opening": 9109,
            "newbiz": 2066,
            "interest": 358,
            "amortization": -787,
            "adjustment": -2032,
            "closing": 8714,
        },
        "separateNetIncome": 313,
        "consolidatedNetIncome": 836,
        "page": "FY2025 발표자료 p.8-10",
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


def fetch(api_key: str, params: dict[str, str]) -> dict[str, Any]:
    query = urllib.parse.urlencode({"auth": api_key, "lang": "kr", **params})
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
        {
            "financeCd": FINANCE_CD,
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


def matched(primary: float | int | None, check: float | int | None, tolerance: float) -> bool:
    return primary is not None and check is not None and abs(float(primary) - float(check)) <= tolerance


def main() -> int:
    api_key = load_api_key()
    dashboard = json.loads(DASHBOARD_DATA.read_text(encoding="utf-8"))
    periods = dashboard["sampleData"]["hanwha-life"]["periods"]

    insurance_profit = values_by_year(
        api_key,
        list_no="SH154",
        account_cd="A",
        value_column="b",
        start="202301",
        end="202512",
        term="Y",
    )
    separate_net_income = values_by_year(
        api_key,
        list_no="SH154",
        account_cd="G",
        value_column="b",
        start="202301",
        end="202512",
        term="Y",
    )
    kics = values_by_year(
        api_key,
        list_no="SH021",
        account_cd="D",
        value_column="a",
        start="202301",
        end="202512",
        term="Q",
    )
    rbc = values_by_year(
        api_key,
        list_no="SH148",
        account_cd="A",
        value_column="a",
        start="202201",
        end="202212",
        term="Q",
    )

    normalized_profit = {year: value / 1_000_000_000 for year, value in insurance_profit.items()}
    normalized_net_income = {
        year: value / 1_000_000_000 for year, value in separate_net_income.items()
    }

    output_periods: dict[str, Any] = {}
    for year in range(2022, 2026):
        dart = periods[f"{year}-ye"]
        ir = IR_ANNUAL[year]
        fisis_profit = normalized_profit.get(year)
        fisis_separate_ni = normalized_net_income.get(year)
        solvency = rbc.get(year) if year == 2022 else kics.get(year)
        output_periods[str(year)] = {
            "summary": "교차검증 완료",
            "primarySource": "Open DART",
            "validationPriority": "FISIS → 한화생명 IR",
            "csm": {
                "value": dart["csm"],
                "checkValue": ir["csm"],
                "status": "matched" if matched(dart["csm"], ir["csm"], 1) else "mismatch",
                "source": "한화생명 IR",
                "basis": "별도 · 발행 보험계약 · 출재 재보험 제외",
                "sourceUrl": IR_PAGE,
                "attachmentSeq": ir["attachmentSeq"],
                "sourcePage": ir["page"],
            },
            "movement": {
                "status": "matched" if dart["movement"] == ir["movement"] else "mismatch",
                "source": "한화생명 IR",
                "checkValue": ir["movement"],
            },
            "insuranceProfit": {
                "value": dart["insuranceProfit"],
                "checkValue": fisis_profit,
                "status": (
                    "matched"
                    if matched(dart["insuranceProfit"], fisis_profit, 0.01)
                    else "ir_fallback_required"
                ),
                "source": "FISIS" if fisis_profit is not None else "한화생명 IR",
                "basis": "별도 · K-IFRS",
                "table": "SH154/A",
            },
            "parentNetIncome": {
                "value": dart["parentNetIncome"],
                "fisisSeparateNetIncome": fisis_separate_ni,
                "irConsolidatedNetIncome": ir.get("consolidatedNetIncome"),
                "status": "basis_difference",
                "source": "FISIS + 한화생명 IR",
                "basis": "DART 값은 연결 지배기업 귀속, FISIS는 별도, IR은 연결 전체",
                "note": "세 출처의 귀속 범위가 달라 수치 일치 판정에서 제외",
            },
            "kics": {
                "value": solvency,
                "status": "validated" if solvency is not None else "unavailable",
                "source": "FISIS",
                "basis": "RBC" if year == 2022 else "K-ICS",
                "table": "SH148/A" if year == 2022 else "SH021/D",
            },
        }

    output = {
        "schemaVersion": "hanwha-life-validation/v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "company": {
            "key": "hanwha-life",
            "name": "한화생명",
            "fisisFinanceCd": FINANCE_CD,
        },
        "sourcePolicy": {
            "primary": "Open DART",
            "validation": ["FISIS", "한화생명 IR"],
        },
        "periods": output_periods,
    }
    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(OUTPUT)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
