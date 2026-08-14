# -*- coding: utf-8 -*-
"""Collect quarterly insurance profit and net income from FISIS.

FISIS is the validation/fallback source for dashboard financial metrics.  The
API returns `a` as quarter-standalone and `b` as year-to-date cumulative.
"""

from __future__ import annotations

import json
from pathlib import Path

from fisis_life_validation import fetch, load_api_key


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "external-data" / "fisis-quarterly-financials.json"
COMPANIES = {
    "samsung-life": ("삼성생명", "0010595", "SH154"),
    "hanwha-life": ("한화생명", "0010593", "SH154"),
    "kyobo-life": ("교보생명", "0010597", "SH154"),
    "shinhan-life": ("신한라이프", "0010599", "SH154"),
    "samsung-fire": ("삼성화재", "0010633", "SI150"),
    "meritz-fire": ("메리츠화재", "0010626", "SI150"),
    "db-insurance": ("DB손해보험", "0010636", "SI150"),
    "hyundai-marine": ("현대해상", "0010634", "SI150"),
    "kb-insurance": ("KB손해보험", "0010635", "SI150"),
}


def amount(value: object) -> float | None:
    if value in (None, ""):
        return None
    return round(float(str(value).replace(",", "")) / 1_000_000_000, 3)


def rows(api_key: str, finance_cd: str, list_no: str, account_cd: str) -> list[dict]:
    return fetch(
        api_key,
        finance_cd,
        {
            "listNo": list_no,
            "accountCd": account_cd,
            "term": "Q",
            "startBaseMm": "202301",
            "endBaseMm": "202606",
        },
    ).get("list", [])


def main() -> int:
    api_key = load_api_key()
    output = {
        "contract": "csm-quarterly-fisis-financials/v1",
        "source": "FISIS Open API",
        "companies": {},
    }
    for company_key, (name, finance_cd, list_no) in COMPANIES.items():
        print(f"collecting {name}", flush=True)
        periods: dict[str, dict] = {}
        for metric, account_cd in (("insuranceProfit", "A"), ("netIncome", "G")):
            for row in rows(api_key, finance_cd, list_no, account_cd):
                base_month = row["base_month"]
                year = int(base_month[:4])
                quarter = int(base_month[4:6]) // 3
                if quarter not in (1, 2, 3, 4):
                    continue
                period = periods.setdefault(f"{year}-q{quarter}", {})
                period[metric] = {
                    "standalone": amount(row.get("a")),
                    "cumulative": amount(row.get("b")),
                    "accountCode": account_cd,
                    "accountName": row.get("account_nm"),
                }
        output["companies"][company_key] = {
            "name": name,
            "financeCd": finance_cd,
            "listNo": list_no,
            "periods": periods,
        }
    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(OUTPUT)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
