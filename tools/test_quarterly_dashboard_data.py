# -*- coding: utf-8 -*-
"""Deterministic integrity checks for the nine-company quarterly data set."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "external-data" / "csm-quarterly-dashboard-data.json"
EXPECTED_COMPANIES = 9
EXPECTED_QUARTERS = [
    *(f"{year}-q{quarter}" for year in (2023, 2024, 2025) for quarter in (1, 2, 3, 4)),
    "2026-q1",
]


def close(left: float, right: float, tolerance: float = 0.001) -> bool:
    return abs(left - right) <= tolerance


def main() -> int:
    data = json.loads(DATA.read_text(encoding="utf-8"))
    companies = data["sampleData"]
    assert len(companies) == EXPECTED_COMPANIES
    assert not data["quarterlyBuild"]["errors"]

    checked = 0
    for company_key, company in companies.items():
        periods = company["periods"]
        for period_key in EXPECTED_QUARTERS:
            assert period_key in periods, f"{company_key} missing {period_key}"
            period = periods[period_key]
            for metric in ("csm", "insuranceProfit", "parentNetIncome", "kics"):
                assert period[metric] is not None, f"{company_key} {period_key} missing {metric}"
            movement = period["movement"]
            calculated = sum(
                movement[key]
                for key in ("opening", "newbiz", "interest", "adjustment", "amortization")
            )
            assert calculated == movement["closing"], f"{company_key} {period_key} movement"
            assert period["csm"] == movement["closing"]
            checked += 1

        for year in (2023, 2024, 2025):
            for quarter in (2, 3, 4):
                current = periods[f"{year}-q{quarter}"]["movement"]
                prior = periods[f"{year}-q{quarter - 1}"]["movement"]
                assert current["opening"] == prior["closing"], (
                    f"{company_key} {year}-q{quarter} opening continuity"
                )
            assert periods[f"{year}-q4"]["csm"] == periods[f"{year}-ye"]["csm"]
            insurance_total = sum(periods[f"{year}-q{quarter}"]["insuranceProfit"] for quarter in range(1, 5))
            assert close(insurance_total, periods[f"{year}-ye"]["insuranceProfit"]), (
                f"{company_key} {year} insurance profit reconciliation"
            )
            if year >= 2024:
                net_total = sum(periods[f"{year}-q{quarter}"]["parentNetIncome"] for quarter in range(1, 5))
                assert close(net_total, periods[f"{year}-ye"]["parentNetIncome"]), (
                    f"{company_key} {year} net income reconciliation"
                )

    print(f"quarterly integrity checks passed: {checked} company-periods")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
