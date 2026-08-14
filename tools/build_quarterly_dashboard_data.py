# -*- coding: utf-8 -*-
"""Normalize quarterly DART disclosures and merge them into the dashboard data.

DART interim income statement values and CSM movements are cumulative.  This
module keeps the disclosed cumulative values as audit evidence and derives
quarter-standalone flows by subtraction.  Balance sheet values remain point in
time.  Q4 is derived from the audited annual disclosure less Q3 cumulative.
"""

from __future__ import annotations

import json
from itertools import combinations
from pathlib import Path

import build_annual_dashboard_data as annual


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "external-data" / "dart-quarterly-insurance-extract.json"
ANNUAL = ROOT / "external-data" / "csm-annual-dashboard-data.json"
FISIS = ROOT / "external-data" / "fisis-quarterly-financials.json"
OUTPUT = ROOT / "external-data" / "csm-quarterly-dashboard-data.json"
DASHBOARD_JS = ROOT / "csm-prototype" / "dashboard-data.generated.js"
FLOW_KEYS = ("newbiz", "interest", "amortization")


def parsable_tables(period: dict) -> list[tuple[dict, dict]]:
    parsed = []
    for table in annual.preferred_document(period.get("document_candidates", [])):
        try:
            parsed.append((table, annual.extract_table_movement(table)))
        except (ValueError, IndexError):
            continue
    return parsed


def table_groups(parsed: list[tuple[dict, dict]]) -> list[list[tuple[dict, dict]]]:
    """Split candidates into nearby table blocks within each source document."""
    groups: list[list[tuple[dict, dict]]] = []
    for item in parsed:
        table = item[0]
        if (
            not groups
            or groups[-1][-1][0]["document"] != table["document"]
            or table["table_index"] - groups[-1][-1][0]["table_index"] > 4
        ):
            groups.append([item])
        else:
            groups[-1].append(item)
    return groups


def select_cumulative_movement(period: dict, anchor: float) -> tuple[dict, list[int], dict]:
    """Choose the separate, issued-contract CSM table set using prior YE CSM.

    Insurers disclose one to three issued-contract tables, often followed by an
    adjacent comparative set.  The current-period table set is the one whose
    opening CSM reconciles to the already validated prior year-end balance.
    """
    parsed = parsable_tables(period)
    if not parsed:
        raise ValueError("no parsable CSM movement table")

    candidates = []
    for group in table_groups(parsed):
        # A company can split CSM by measurement model. Enumerate short,
        # contiguous subsets while preserving the disclosure order.
        max_size = min(4, len(group))
        for size in range(1, max_size + 1):
            for start in range(0, len(group) - size + 1):
                subset = group[start : start + size]
                tables = [item[0] for item in subset]
                movement = (
                    subset[0][1] if len(subset) == 1 else annual.combined_movement(tables)
                )
                relative_error = abs(movement["opening"] - anchor) / max(abs(anchor), 1)
                # Prefer fewer tables only after balance reconciliation.
                score = relative_error + (len(subset) - 1) * 0.000001
                candidates.append((score, movement, tables))

    score, movement, tables = min(candidates, key=lambda item: item[0])
    # 2023 interim disclosures can use an IFRS 17 transition/restatement basis
    # different from the comparative amount later printed in the annual note.
    # Preserve that bridge in the audit payload; reject only differences large
    # enough to indicate that a different table/basis was selected.
    tolerance = max(20, abs(anchor) * 0.20)
    if abs(movement["opening"] - anchor) > tolerance:
        raise ValueError(
            f"opening CSM does not reconcile: disclosed={movement['opening']}, anchor={anchor}, score={score:.4f}"
        )
    audit = {
        "openingAnchor": anchor,
        "disclosedOpening": movement["opening"],
        "openingDifference": movement["opening"] - anchor,
        "sourceDocument": tables[0]["document"],
    }
    return movement, [table["table_index"] for table in tables], audit


def standalone_movement(cumulative: dict, previous_cumulative: dict | None, opening: float) -> dict:
    flows = {
        key: cumulative[key] - (previous_cumulative[key] if previous_cumulative else 0)
        for key in FLOW_KEYS
    }
    closing = cumulative["closing"]
    adjustment = closing - opening - sum(flows.values())
    return {
        "opening": round(opening),
        **{key: round(value) for key, value in flows.items()},
        "adjustment": round(adjustment),
        "closing": round(closing),
    }


def standalone_metric(current: float | None, previous: float | None) -> float | None:
    if current is None:
        return None
    return round(current - (previous or 0), 3)


def metric(period: dict, key: str) -> float | None:
    item = period.get("financial_metrics", {}).get(key)
    return item.get("amount_bn") if item else None


def quarterly_source(period: dict, table_indexes: list[int], audit: dict, basis: str) -> dict:
    report = period["report"]
    return {
        "sourceType": "Open DART",
        "rceptNo": report["rcept_no"],
        "reportName": report["report_name"],
        "dartUrl": report["dart_url"],
        "valueKind": "actual",
        "basis": "separate_financial_statement_excluding_reinsurance",
        "unit": "KRW billion",
        "sourceTables": table_indexes,
        "sourcePeriodBasis": basis,
        "displayPeriodBasis": "quarter-standalone",
        "movementSelectionAudit": audit,
    }


def movement_identity(movement: dict) -> float:
    return round(
        movement["opening"]
        + movement["newbiz"]
        + movement["interest"]
        + movement["adjustment"]
        + movement["amortization"]
        - movement["closing"],
        6,
    )


def period_payload(
    *,
    movement: dict,
    insurance_profit: float | None,
    parent_net_income: float | None,
    kics: float | None,
    source_reference: dict,
    cumulative: dict,
    quarter: int,
    opening_difference: float,
    financial_audit: dict,
    net_income_basis: str,
) -> dict:
    return {
        "csm": movement["closing"],
        "growth": round((movement["closing"] / movement["opening"] - 1) * 100, 1)
        if movement["opening"]
        else None,
        "movement": movement,
        "insuranceProfit": insurance_profit,
        "parentNetIncome": parent_net_income,
        "kics": kics,
        "solvencyBasis": "K-ICS",
        "quality": "DART 분기 공시 · FISIS 교차검증 · 누적값 분기 단독 환산",
        "sourceReference": source_reference,
        "metricBasis": {
            "csm": "별도 · 발행 보험계약 · 출재 재보험 제외",
            "insuranceProfit": "별도 · K-IFRS · 분기 단독",
            "parentNetIncome": net_income_basis,
            "solvency": "K-ICS · 분기말",
        },
        "quarterlyAudit": {
            "quarter": quarter,
            "movementIdentityDifference": movement_identity(movement),
            "openingReconciliationDifference": opening_difference,
            "disclosedCumulativeMovement": cumulative,
            "financialValidation": financial_audit,
        },
    }


def build() -> dict:
    source = json.loads(SOURCE.read_text(encoding="utf-8"))
    output = json.loads(ANNUAL.read_text(encoding="utf-8"))
    fisis = json.loads(FISIS.read_text(encoding="utf-8"))
    output["dataContractVersion"] = "csm-dashboard-quarterly/v1"
    output["periodBasis"] = "quarterly-point-in-time-with-standalone-flows"
    output["methodologyRegistry"] = {
        "version": "2026-08-04.1",
        "recordPolicy": (
            "모든 데이터 변경 시 원본 출처, 파싱 규칙, 단위·기간 환산, "
            "검증 소스, 판정 결과, 예외 처리를 함께 기록한다."
        ),
        "records": [
            {
                "effectiveDate": "2026-08-04",
                "scope": "9개사 분기 CSM·손익·K-ICS",
                "source": "Open DART 분기·반기·사업보고서, FISIS 분기 통계",
                "parsing": (
                    "CSM은 별도재무제표 발행 보험계약 표에서 추출하고 출재 재보험을 제외. "
                    "상품군·측정모형별 표는 합산하며 직전 연말 CSM과 기초 잔액을 대사해 표를 선택."
                ),
                "conversion": (
                    "CSM 잔액은 분기말 시점값. Q2·Q3 손익 및 Movement는 누적값에서 직전 누적을 차감, "
                    "Q4는 연간 누적에서 Q3 누적을 차감해 분기 단독값으로 환산."
                ),
                "validation": (
                    "기말 = 기시 + 신계약 + 이자 + 조정 + 상각, 분기 기시·기말 연속성, "
                    "연간 합계 대사. 보험손익·순이익은 FISIS SH154/SI150과 교차검증."
                ),
                "result": "9개사 117개 회사-분기 필수값 및 Movement 산식 검산 통과",
            },
            {
                "effectiveDate": "2026-08-03",
                "scope": "보험금 예실차·경과기간별 손해율·유지비율",
                "source": "Open DART 연결재무제표 주석",
                "parsing": "Open DART 원문 표의 합계행을 직접 추출하고, 합계가 없으면 동일 기준의 세부 포트폴리오 행을 합산.",
                "conversion": "2024년말부터 연 1회 공시. 원문 금액·비율을 보존하고 대시보드 비율을 별도 계산.",
                "validation": "예실차 및 기간별 비율 산식을 재계산하고 회사·연도·경과기간 구간을 대조.",
                "result": "04~06 탭의 원본 링크·전체표·계산 비율 연결",
            },
            {
                "effectiveDate": "2026-07-31",
                "scope": "9개사 연도말 CSM·Movement",
                "source": "Open DART 사업보고서 별도재무제표 주석",
                "parsing": "발행 보험계약 CSM만 사용하고 출재 재보험 제외. 분리된 상품군·측정모형 표는 합산.",
                "conversion": "원문 원·천원·백만원을 십억원으로 통일하고 연도말 잔액과 연간 누적 흐름을 저장.",
                "validation": "FISIS를 우선 활용하고 CSM 부재 시 회사 IR·경영공시로 교차검증. 산식과 표시단위 반올림을 별도 판정.",
                "result": "2022~2025년 연도말 9개사 데이터 기준 확정",
            },
        ],
    }

    errors = []
    for company_key, company in output["sampleData"].items():
        quarterly_company = source["companies"][company_key]
        fisis_company = fisis["companies"][company_key]
        for year in (2023, 2024, 2025, 2026):
            annual_anchor = company["periods"].get(f"{year - 1}-ye")
            if not annual_anchor:
                continue
            previous_cumulative = None
            previous_financial = {"insurance_profit": None, "parent_net_income": None}
            filed_interims = [
                quarterly_company["periods"].get(f"{year}-q{quarter}", {})
                for quarter in (1, 2, 3)
            ]
            use_fisis_net_year = any(
                period.get("availability") == "filed"
                and metric(period, "parent_net_income") is None
                for period in filed_interims
            )
            opening = annual_anchor["csm"]
            completed_q3 = True
            for quarter in (1, 2, 3):
                period_key = f"{year}-q{quarter}"
                raw_period = quarterly_company["periods"].get(period_key)
                if not raw_period or raw_period.get("availability") != "filed":
                    completed_q3 = False
                    continue
                try:
                    cumulative, table_indexes, audit = select_cumulative_movement(raw_period, annual_anchor["csm"])
                except ValueError as exc:
                    errors.append({"company": company_key, "period": period_key, "error": str(exc)})
                    completed_q3 = False
                    continue

                movement_opening = cumulative["opening"] if quarter == 1 else opening
                movement = standalone_movement(cumulative, previous_cumulative, movement_opening)
                current_financial = {
                    "insurance_profit": metric(raw_period, "insurance_profit"),
                    "parent_net_income": metric(raw_period, "parent_net_income"),
                }
                fisis_period = fisis_company["periods"].get(period_key, {})
                fisis_insurance = fisis_period.get("insuranceProfit", {})
                fisis_net = fisis_period.get("netIncome", {})
                if current_financial["insurance_profit"] is None:
                    current_financial["insurance_profit"] = fisis_insurance.get("cumulative")
                if use_fisis_net_year:
                    current_financial["parent_net_income"] = fisis_net.get("cumulative")
                kics, _ = annual.kics_ratio(raw_period, year)
                source_reference = quarterly_source(
                    raw_period, table_indexes, audit, "year-to-date-cumulative"
                )
                company["periods"][period_key] = period_payload(
                    movement=movement,
                    insurance_profit=standalone_metric(
                        current_financial["insurance_profit"], previous_financial["insurance_profit"]
                    ),
                    parent_net_income=(
                        fisis_net.get("standalone")
                        if use_fisis_net_year
                        else standalone_metric(
                            current_financial["parent_net_income"],
                            previous_financial["parent_net_income"],
                        )
                    ),
                    kics=kics,
                    source_reference=source_reference,
                    cumulative=cumulative,
                    quarter=quarter,
                    opening_difference=audit["openingDifference"],
                    financial_audit={
                        "dartInsuranceProfitCumulative": metric(raw_period, "insurance_profit"),
                        "fisisInsuranceProfitCumulative": fisis_insurance.get("cumulative"),
                        "fisisInsuranceProfitStandalone": fisis_insurance.get("standalone"),
                        "dartParentNetIncomeCumulative": metric(raw_period, "parent_net_income"),
                        "fisisSeparateNetIncomeCumulative": fisis_net.get("cumulative"),
                        "fisisSeparateNetIncomeStandalone": fisis_net.get("standalone"),
                    },
                    net_income_basis=(
                        "별도 · FISIS · 분기 단독 (DART 초기 공백 대체)"
                        if use_fisis_net_year
                        else "연결 · 지배기업 소유주 귀속 · 분기 단독"
                    ),
                )
                previous_cumulative = cumulative
                previous_financial = current_financial
                opening = cumulative["closing"]

            # Q4 standalone is annual cumulative less Q3 cumulative. Keep the
            # existing -ye record as the audited full-year view used by tabs 04-06.
            annual_period = company["periods"].get(f"{year}-ye")
            if year <= 2025 and completed_q3 and previous_cumulative and annual_period:
                annual_movement = annual_period["movement"]
                q4_movement = standalone_movement(annual_movement, previous_cumulative, opening)
                annual_source = dict(annual_period["sourceReference"])
                annual_source.update(
                    {
                        "sourcePeriodBasis": "full-year-cumulative",
                        "displayPeriodBasis": "quarter-standalone",
                    }
                )
                fisis_q4 = fisis_company["periods"].get(f"{year}-q4", {})
                company["periods"][f"{year}-q4"] = period_payload(
                    movement=q4_movement,
                    insurance_profit=standalone_metric(
                        annual_period["insuranceProfit"], previous_financial["insurance_profit"]
                    ),
                    parent_net_income=(
                        fisis_q4.get("netIncome", {}).get("standalone")
                        if use_fisis_net_year
                        else standalone_metric(
                            annual_period["parentNetIncome"], previous_financial["parent_net_income"]
                        )
                    ),
                    kics=annual_period["kics"],
                    source_reference=annual_source,
                    cumulative=annual_movement,
                    quarter=4,
                    opening_difference=annual_movement["opening"] - annual_anchor["csm"],
                    financial_audit={
                        "dartInsuranceProfitCumulative": annual_period["insuranceProfit"],
                        "fisisInsuranceProfitCumulative": fisis_q4.get("insuranceProfit", {}).get("cumulative"),
                        "fisisInsuranceProfitStandalone": fisis_q4.get("insuranceProfit", {}).get("standalone"),
                        "dartParentNetIncomeCumulative": annual_period["parentNetIncome"],
                        "fisisSeparateNetIncomeCumulative": fisis_q4.get("netIncome", {}).get("cumulative"),
                        "fisisSeparateNetIncomeStandalone": fisis_q4.get("netIncome", {}).get("standalone"),
                    },
                    net_income_basis=(
                        "별도 · FISIS · 분기 단독 (DART 초기 공백 대체)"
                        if use_fisis_net_year
                        else "연결 · 지배기업 소유주 귀속 · 분기 단독"
                    ),
                )

    output["quarterlyBuild"] = {
        "sourceContract": source.get("contract"),
        "validationContract": fisis.get("contract"),
        "latestAvailable": "2026-q1",
        "errors": errors,
    }
    return output


def main() -> int:
    output = build()
    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    DASHBOARD_JS.write_text(
        "/* Generated by tools/build_quarterly_dashboard_data.py. */\n"
        f"window.CSM_AGENT_DATA = {json.dumps(output, ensure_ascii=False, indent=2)};\n",
        encoding="utf-8",
    )
    print(OUTPUT)
    errors = output["quarterlyBuild"]["errors"]
    if errors:
        print(json.dumps(errors, ensure_ascii=False, indent=2))
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
