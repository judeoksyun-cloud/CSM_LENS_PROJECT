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
    "2026-q2",
]


def close(left: float, right: float, tolerance: float = 0.002) -> bool:
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
            for metric in ("csm", "insuranceProfit", "parentNetIncome"):
                assert period[metric] is not None, f"{company_key} {period_key} missing {metric}"
            if company_key == "hanwha-life" and period_key == "2026-q2":
                assert period["kics"] is None
                assert (
                    period["quarterlyAudit"]["financialValidation"]["solvencyStatus"]
                    == "pending_in_source"
                )
            else:
                assert period["kics"] is not None, f"{company_key} {period_key} missing kics"
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

        assert periods["2026-q2"]["movement"]["opening"] == periods["2026-q1"]["movement"]["closing"], (
            f"{company_key} 2026-q2 opening continuity"
        )
        q2_audit = periods["2026-q2"]["quarterlyAudit"]["financialValidation"]
        assert q2_audit["insuranceProfitAccountId"] == "ifrs-full_InsuranceServiceResult"
        assert q2_audit["parentNetIncomeAccountId"] == "ifrs-full_ProfitLossAttributableToOwnersOfParent"
        assert q2_audit["insuranceProfitStandaloneStatus"] == "matched"
        assert q2_audit["parentNetIncomeStandaloneStatus"] == "matched"
        assert abs(q2_audit["insuranceProfitStandaloneDifference"]) <= 0.001
        assert abs(q2_audit["parentNetIncomeStandaloneDifference"]) <= 0.001

    shinhan = companies["shinhan-life"]["periods"]
    assert shinhan["2026-q1"]["csm"] == 7722
    assert shinhan["2026-q2"]["csm"] == 7911
    assert shinhan["2026-q2"]["sourceReference"]["sourceTables"] == [434, 436, 438]
    assert shinhan["2026-q2"]["quarterlyAudit"]["openingReconciliationDifference"] == 0

    hanwha = companies["hanwha-life"]["periods"]
    assert close(hanwha["2026-q1"]["parentNetIncome"], 324.395)
    assert close(hanwha["2026-q2"]["parentNetIncome"], 447.554)

    db = companies["db-insurance"]["periods"]
    assert db["2025-ye"]["csm"] == 12205
    assert db["2025-ye"]["sourceReference"]["sourceTables"] == [281, 285]
    assert db["2026-q1"]["movement"]["opening"] == db["2025-ye"]["csm"]

    print(f"quarterly integrity checks passed: {checked} company-periods")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
