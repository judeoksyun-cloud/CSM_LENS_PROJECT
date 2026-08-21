# -*- coding: utf-8 -*-
"""Collect quarterly insurance disclosures for the nine-company CSM dashboard.

The extractor stores DART source tables and statement accounts. Q4 is supplied
by the existing annual pipeline; this collector covers Q1, Q2 and Q3 reports.
It writes after every period so an interrupted run can be resumed safely.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import annual_dart_insurance_extract as annual


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "external-data" / "dart-quarterly-insurance-extract.json"
YEARS = (2023, 2024, 2025, 2026)
PERIODS = {
    "q1": {"reprt_code": "11013", "detail": "A003", "month": "03", "name": "분기보고서"},
    "q2": {"reprt_code": "11012", "detail": "A002", "month": "06", "name": "반기보고서"},
    "q3": {"reprt_code": "11014", "detail": "A003", "month": "09", "name": "분기보고서"},
}


def report_candidates(corp_code: str, year: int, quarter: str) -> list[dict]:
    meta = PERIODS[quarter]
    result = annual.fetch_json(
        "list.json",
        {
            "corp_code": corp_code,
            "bgn_de": f"{year}0401" if quarter == "q1" else f"{year}0701" if quarter == "q2" else f"{year}1001",
            "end_de": f"{year}0630" if quarter == "q1" else f"{year}0930" if quarter == "q2" else f"{year}1231",
            "last_reprt_at": "N",
            "pblntf_detail_ty": meta["detail"],
            "page_count": "100",
        },
    )
    if result.get("status") not in {"000", "013"}:
        raise RuntimeError(f"DART list error {result.get('status')}: {result.get('message')}")
    expected = f"({year}.{meta['month']})"
    return sorted(
        [
            item
            for item in result.get("list", [])
            if meta["name"] in item.get("report_nm", "") and expected in item.get("report_nm", "")
        ],
        key=lambda item: item.get("rcept_dt", ""),
        reverse=True,
    )


def usable_report(corp_code: str, year: int, quarter: str) -> tuple[dict | None, list[dict]]:
    candidates = report_candidates(corp_code, year, quarter)
    if not candidates:
        return None, []

    # Prefer the latest correction when it contains a usable body. Attachment-only
    # corrections sometimes return no CSM tables, so fall back through older filings.
    fallback_report = None
    fallback_tables: list[dict] = []
    for item in candidates:
        report = {
            "rcept_no": item["rcept_no"],
            "report_name": item["report_nm"],
            "rcept_dt": item["rcept_dt"],
            "dart_url": f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={item['rcept_no']}",
        }
        tables = annual.candidate_tables(item["rcept_no"])
        if fallback_report is None:
            fallback_report, fallback_tables = report, tables
        if any("보험계약마진" in "".join("".join(row) for row in table.get("rows", [])) for table in tables):
            return report, tables
    return fallback_report, fallback_tables


def accounts(corp_code: str, year: int, reprt_code: str, fs_div: str) -> list[dict]:
    result = annual.fetch_json(
        "fnlttSinglAcntAll.json",
        {
            "corp_code": corp_code,
            "bsns_year": str(year),
            "reprt_code": reprt_code,
            "fs_div": fs_div,
        },
    )
    if result.get("status") not in {"000", "013"}:
        raise RuntimeError(f"DART account error {result.get('status')}: {result.get('message')}")
    return result.get("list", [])


def account_payload(row: dict | None) -> dict | None:
    if not row:
        return None
    # Q3 CIS rows expose the three-month value in thstrm_amount and the
    # year-to-date value in thstrm_add_amount. Q1 and H1 use thstrm_amount.
    raw_amount = row.get("thstrm_add_amount") or row.get("thstrm_amount") or row.get("raw_amount")
    disclosed_standalone = row.get("thstrm_amount") or row.get("raw_amount")
    return {
        "account_id": row.get("account_id"),
        "account_nm": row.get("account_nm"),
        "raw_amount": raw_amount,
        "amount_bn": row.get("amount_bn") if row.get("amount_bn") is not None else annual.amount_bn(raw_amount),
        "disclosed_standalone_raw_amount": disclosed_standalone,
        "disclosed_standalone_amount_bn": annual.amount_bn(disclosed_standalone),
        "sj_nm": row.get("sj_nm"),
        "account_detail": row.get("account_detail"),
        "thstrm_nm": row.get("thstrm_nm"),
    }


def find_quarterly_account(rows: list[dict], predicate) -> dict | None:
    for row in rows:
        if row.get("sj_nm") != "포괄손익계산서":
            continue
        raw_amount = row.get("thstrm_add_amount") or row.get("thstrm_amount")
        if annual.amount_bn(raw_amount) is None:
            continue
        if predicate(annual.compact(row.get("account_nm"))):
            return row
    return None


def find_quarterly_account_by_id(rows: list[dict], account_id: str) -> dict | None:
    """Find a standardized XBRL concept before relying on a Korean label.

    Some insurers print the parent-owner profit row as only ``지배기업의 소유주``.
    Matching the label alone can therefore select total profit instead.  The DART
    account ID is stable across those presentation differences.
    """
    for row in rows:
        if row.get("sj_nm") != "포괄손익계산서" or row.get("account_id") != account_id:
            continue
        raw_amount = row.get("thstrm_add_amount") or row.get("thstrm_amount")
        if annual.amount_bn(raw_amount) is not None:
            return row
    return None


def financial_metrics(corp_code: str, year: int, reprt_code: str) -> dict:
    ofs = accounts(corp_code, year, reprt_code, "OFS")
    cfs = accounts(corp_code, year, reprt_code, "CFS")
    insurance = find_quarterly_account_by_id(ofs, "ifrs-full_InsuranceServiceResult")
    if insurance is None:
        insurance = find_quarterly_account(
            ofs,
            lambda name: name in {"보험서비스손익", "보험서비스결과", "보험손익"},
        )
    parent = find_quarterly_account_by_id(
        cfs, "ifrs-full_ProfitLossAttributableToOwnersOfParent"
    )
    if parent is None:
        parent = find_quarterly_account(
            cfs,
            lambda name: (
                "포괄" not in name
                and "순이익" in name
                and (("지배기업" in name and ("소유주" in name or "지분" in name)) or "지배주주" in name)
            ),
        )
    if parent is None:
        parent = find_quarterly_account(
            cfs,
            lambda name: name in {
                "당기순이익", "당기순이익(손실)", "분기순이익", "반기순이익"
            },
        )
    return {
        "insurance_profit": account_payload(insurance),
        "parent_net_income": account_payload(parent),
    }


def empty_output() -> dict:
    return {
        "contract": "csm-quarterly-dart-extract/v1",
        "source_policy": "Open DART API only",
        "period_basis": "quarterly-cumulative-source",
        "companies": {
            key: {**meta, "periods": {}}
            for key, meta in annual.COMPANIES.items()
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--company", choices=annual.COMPANIES)
    parser.add_argument("--period", help="Single period such as 2025-q1")
    parser.add_argument("--fresh", action="store_true")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Refetch selected periods while preserving every other stored period",
    )
    args = parser.parse_args()

    output = empty_output() if args.fresh or not OUTPUT.exists() else json.loads(OUTPUT.read_text(encoding="utf-8"))
    company_keys = [args.company] if args.company else list(annual.COMPANIES)

    for company_key in company_keys:
        company_meta = annual.COMPANIES[company_key]
        output_company = output["companies"][company_key]
        for year in YEARS:
            for quarter, period_meta in PERIODS.items():
                period_key = f"{year}-{quarter}"
                if args.period and period_key != args.period:
                    continue
                existing_period = output_company["periods"].get(period_key)
                if (
                    existing_period
                    and existing_period.get("availability") == "filed"
                    and not args.fresh
                    and not args.force
                ):
                    continue
                print(f"collecting {company_meta['name']} {period_key}", flush=True)
                report, tables = usable_report(company_meta["corp_code"], year, quarter)
                if report is None:
                    output_company["periods"][period_key] = {
                        "availability": "not_filed",
                        "report": None,
                        "financial_metrics": {},
                        "document_candidates": [],
                    }
                else:
                    output_company["periods"][period_key] = {
                        "availability": "filed",
                        "report": report,
                        "reprt_code": period_meta["reprt_code"],
                        "financial_metrics": financial_metrics(
                            company_meta["corp_code"], year, period_meta["reprt_code"]
                        ),
                        "document_candidates": tables,
                    }
                OUTPUT.parent.mkdir(parents=True, exist_ok=True)
                OUTPUT.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")

    print(OUTPUT)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
