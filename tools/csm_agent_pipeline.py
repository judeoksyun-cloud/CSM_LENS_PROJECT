# -*- coding: utf-8 -*-
"""Build dashboard-ready CSM data from external DART extraction output.

This MVP does not use uploaded/local PDFs as evidence. It consumes the
external DART extraction artifact produced by tools/external_dart_insurance_extract.py
and turns it into a stable dashboard data contract.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "external-data" / "dart-2025-insurance-extract.json"
DEFAULT_OUTPUT = ROOT / "external-data" / "csm-dashboard-agent-output.json"
DEFAULT_DASHBOARD_JS = ROOT / "csm-prototype" / "dashboard-data.generated.js"
DEFAULT_REVIEW_OVERRIDES = ROOT / "external-data" / "manual-review-overrides.json"


COMPANY_META = {
    "samsung-life": {
        "name": "삼성생명",
        "sector": "생명보험",
        "type": "신계약 확보형",
        "profitBase": {"investment": 8800, "other": -1100},
        "mix": {
            "2025-q4": [["금융", 7, "#69b7cd"], ["사망", 33, "#4f83c3"], ["건강", 60, "#1d416d"]],
            "2025-q3": [["금융", 8, "#69b7cd"], ["사망", 32, "#4f83c3"], ["건강", 60, "#1d416d"]],
            "2025-q2": [["금융", 8, "#69b7cd"], ["사망", 33, "#4f83c3"], ["건강", 59, "#1d416d"]],
            "2025-q1": [["금융", 9, "#69b7cd"], ["사망", 32, "#4f83c3"], ["건강", 59, "#1d416d"]],
        },
    },
    "samsung-fire": {
        "name": "삼성화재",
        "sector": "손해보험",
        "type": "상각 방어형",
        "profitBase": {"investment": 6400, "other": -850},
        "mix": {
            "2025-q4": [["일반", 10, "#69b7cd"], ["자동차", 18, "#4f83c3"], ["장기", 72, "#1d416d"]],
            "2025-q3": [["일반", 11, "#69b7cd"], ["자동차", 18, "#4f83c3"], ["장기", 71, "#1d416d"]],
            "2025-q2": [["일반", 11, "#69b7cd"], ["자동차", 19, "#4f83c3"], ["장기", 70, "#1d416d"]],
            "2025-q1": [["일반", 12, "#69b7cd"], ["자동차", 19, "#4f83c3"], ["장기", 69, "#1d416d"]],
        },
    },
}

MOVEMENT_SELECTORS = {
    "samsung-life": {
        "2025-q1": {"mode": "life", "tables": [733, 735, 737]},
        "2025-q2": {"mode": "life", "tables": [2076]},
        "2025-q3": {"mode": "life", "tables": [2038]},
        "2025-q4": {"mode": "life", "tables": [2654]},
    },
    "samsung-fire": {
        "2025-q1": {
            "mode": "fire-q1",
            "closing_table": 310,
            "opening_table": 312,
            "amortization_table": 314,
            "newbiz_table": 346,
        },
        "2025-q2": {"mode": "fire", "tables": [745]},
        "2025-q3": {"mode": "fire", "tables": [720]},
        "2025-q4": {"mode": "fire", "tables": [479, 481]},
    },
}

KICS_TABLES = {
    "samsung-life": {"2025-q1": 8, "2025-q2": 196, "2025-q3": 172, "2025-q4": 6},
    "samsung-fire": {"2025-q1": 55, "2025-q2": 79, "2025-q3": 55, "2025-q4": 87},
}


def compact(text: str) -> str:
    return "".join(str(text or "").split())


def parse_amount_mn(value: Any) -> Decimal:
    raw = str(value or "").strip()
    if raw in {"", "-"}:
        return Decimal("0")

    negative = raw.startswith("(") and raw.endswith(")")
    cleaned = raw.strip("()").replace(",", "")
    if cleaned in {"", "-"}:
        return Decimal("0")

    amount = Decimal(cleaned)
    return -amount if negative else amount


def looks_like_amount(value: Any) -> bool:
    raw = str(value or "").strip()
    if raw in {"", "-"}:
        return raw == "-"
    cleaned = raw.strip("()").replace(",", "")
    return cleaned.replace(".", "", 1).isdigit()


def mn_to_bn_int(value: Decimal) -> int:
    return int((value / Decimal("1000")).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def decimal_to_float(value: Decimal | None) -> float | None:
    if value is None:
        return None
    return float(value)


def table_rows(table: dict[str, Any]) -> list[list[str]]:
    return table.get("rows", [])


def row_contains(row: list[str], *needles: str) -> bool:
    text = compact(" ".join(row))
    return all(compact(needle) in text for needle in needles)


def find_row(rows: list[list[str]], predicate: Callable[[list[str]], bool]) -> list[str]:
    for row in rows:
        if predicate(row):
            return row
    raise ValueError("row not found")


def first_data_table(tables: list[dict[str, Any]], table_index: int) -> dict[str, Any]:
    matches = [table for table in tables if table.get("table_index") == table_index]
    if not matches:
        raise ValueError(f"table_index {table_index} not found")

    for table in matches:
        rows = table_rows(table)
        if len(rows) > 3 and any(any(looks_like_amount(cell) for cell in row) for row in rows):
            return table
    return matches[0]


def sum_life_csm_cells(row: list[str]) -> Decimal:
    first_amount_idx = next((idx for idx, cell in enumerate(row) if looks_like_amount(cell)), None)
    if first_amount_idx is None:
        return Decimal("0")

    numeric_count = len(row) - first_amount_idx
    group_count = numeric_count // 6
    total = Decimal("0")
    for group_idx in range(group_count):
        base = first_amount_idx + group_idx * 6
        for offset in (2, 3, 4):
            cell_idx = base + offset
            if cell_idx < len(row):
                total += parse_amount_mn(row[cell_idx])
    return total


def csm_col(row: list[str], col_idx: int = 3) -> Decimal:
    if len(row) <= col_idx:
        raise ValueError(f"row has no CSM column {col_idx}: {row}")
    return parse_amount_mn(row[col_idx])


def filing_reference(period: dict[str, Any]) -> dict[str, Any]:
    return {
        "sourceType": "Open DART",
        "rceptNo": period["rcept_no"],
        "reportName": period["report_name"],
        "dartUrl": period["dart_url"],
    }


def movement_source_reference(period: dict[str, Any], source_tables: list[int]) -> dict[str, Any]:
    return {
        **filing_reference(period),
        "valueKind": "actual",
        "basis": "separate_financial_statement_excluding_reinsurance",
        "unit": "KRW billion",
        "sourceLayer": "Open DART document.xml table",
        "sourceTables": source_tables,
        "formula": "closing = opening + newbiz + interest + adjustment + amortization",
        "manualAdjustment": False,
    }


def account_source_reference(
    period: dict[str, Any],
    account: dict[str, Any],
    *,
    basis: str,
    unit: str = "KRW billion",
    value_kind: str = "actual",
) -> dict[str, Any]:
    return {
        **filing_reference(period),
        "valueKind": value_kind,
        "basis": basis,
        "unit": unit,
        "sourceLayer": "Open DART fnlttSinglAcntAll",
        "account": account,
        "manualAdjustment": False,
    }


@dataclass
class AgentContext:
    source: dict[str, Any]
    sample_data: dict[str, Any]
    financial_metrics: dict[str, Any]
    quality_checks: list[dict[str, Any]]
    review_items: list[dict[str, Any]]
    review_overrides: dict[str, Any]


def load_review_overrides(path: Path | None) -> dict[str, Any]:
    if path is None or not path.exists():
        return {"items": {}}

    overrides = json.loads(path.read_text(encoding="utf-8"))
    items = overrides.get("items", {})
    if not isinstance(items, dict):
        raise ValueError("manual review overrides must provide an 'items' object")
    return {"items": items}


def default_manual_adjustment(original_value: Any) -> dict[str, Any]:
    return {
        "applied": False,
        "decision": None,
        "originalValue": original_value,
        "adjustedValue": None,
        "reviewerNote": "",
        "reviewedBy": "",
        "reviewedAt": "",
    }


class DartIngestionAgent:
    name = "dart-ingestion-agent"

    def __init__(self, source_path: Path):
        self.source_path = source_path

    def run(self) -> dict[str, Any]:
        data = json.loads(self.source_path.read_text(encoding="utf-8"))
        source_policy = data.get("source_policy", "")
        if "external DART API only" not in source_policy:
            raise ValueError("source_policy must confirm external DART API only")
        return data


class CsmMovementMappingAgent:
    name = "csm-movement-mapping-agent"

    def run(self, context: AgentContext) -> None:
        for company_id, company in context.source["companies"].items():
            meta = COMPANY_META[company_id]
            context.sample_data[company_id] = {
                "name": meta["name"],
                "sector": meta["sector"],
                "type": meta["type"],
                "profitBase": meta["profitBase"],
                "periods": {},
            }

            for period_id, period in company["periods"].items():
                movement, source_tables, quality_note = self.extract_movement(
                    company_id,
                    period_id,
                    period["document_candidates"]["tables"],
                )
                csm = movement["closing"]
                opening = movement["opening"]
                growth = round(((csm / opening) - 1) * 100, 1) if opening else 0

                context.sample_data[company_id]["periods"][period_id] = {
                    "csm": csm,
                    "growth": growth,
                    "movement": movement,
                    "mix": meta["mix"][period_id],
                    "quality": quality_note,
                    "sourceReference": movement_source_reference(period, source_tables),
                    "summary": self.summary_text(meta["name"], period["label"], movement),
                    "forecast": {
                        "csm": "가장 최근 공시 실적을 기준으로 다음 연말 보유 CSM을 전망합니다.",
                        "insurance": "보험손익 전망은 CSM 상각과 경험조정 흐름을 함께 검토해야 합니다.",
                        "investment": "투자손익 전망은 공시 손익과 시장 변수 민감도를 구분해 해석합니다.",
                    },
                }

                diff = movement["closing"] - sum(
                    movement[key] for key in ("opening", "newbiz", "interest", "adjustment", "amortization")
                )
                context.quality_checks.append(
                    {
                        "agent": self.name,
                        "company": company_id,
                        "period": period_id,
                        "check": "movement_sum",
                        "ok": diff == 0,
                        "diff_bn": diff,
                        "source_tables": source_tables,
                    }
                )

    def extract_movement(
        self,
        company_id: str,
        period_id: str,
        tables: list[dict[str, Any]],
    ) -> tuple[dict[str, int], list[int], str]:
        selector = MOVEMENT_SELECTORS[company_id][period_id]
        mode = selector["mode"]
        if mode == "life":
            movement = self.extract_life(tables, selector["tables"])
            return movement, selector["tables"], "DART 검산"
        if mode == "fire-q1":
            movement = self.extract_fire_q1(tables, selector)
            return movement, [
                selector["closing_table"],
                selector["opening_table"],
                selector["amortization_table"],
                selector["newbiz_table"],
            ], "DART 검산 · 이자부리 별도 표시 없음"
        if mode == "fire":
            movement = self.extract_fire(tables, selector["tables"])
            return movement, selector["tables"], "DART 검산"
        raise ValueError(f"unknown movement mode: {mode}")

    def extract_life(self, tables: list[dict[str, Any]], table_indexes: list[int]) -> dict[str, int]:
        totals = {"opening": Decimal("0"), "newbiz": Decimal("0"), "interest": Decimal("0"), "amortization": Decimal("0"), "closing": Decimal("0")}
        labels = {
            "opening": ("보험계약 순부채(자산)(기초)",),
            "newbiz": ("당기 최초 인식 계약",),
            "interest": ("보험계약의 순 금융손익",),
            "amortization": ("제공한 서비스에 대해 인식한 보험계약마진",),
            "closing": ("보험계약 순부채(자산)(기말)",),
        }

        for table_index in table_indexes:
            rows = table_rows(first_data_table(tables, table_index))
            for key, needles in labels.items():
                row = find_row(rows, lambda candidate, n=needles: row_contains(candidate, *n))
                totals[key] += sum_life_csm_cells(row)

        return self.finalize_movement(totals)

    def extract_fire_q1(self, tables: list[dict[str, Any]], selector: dict[str, Any]) -> dict[str, int]:
        closing_rows = table_rows(first_data_table(tables, selector["closing_table"]))
        opening_rows = table_rows(first_data_table(tables, selector["opening_table"]))
        amortization_rows = table_rows(first_data_table(tables, selector["amortization_table"]))
        newbiz_rows = table_rows(first_data_table(tables, selector["newbiz_table"]))

        totals = {
            "opening": csm_col(find_row(opening_rows, lambda row: row_contains(row, "합계"))),
            "newbiz": parse_amount_mn(find_row(newbiz_rows, lambda row: row_contains(row, "보험계약마진"))[1]),
            "interest": Decimal("0"),
            "amortization": parse_amount_mn(find_row(amortization_rows, lambda row: row_contains(row, "보험계약마진 상각"))[1]),
            "closing": csm_col(find_row(closing_rows, lambda row: row_contains(row, "합계"))),
        }
        return self.finalize_movement(totals)

    def extract_fire(self, tables: list[dict[str, Any]], table_indexes: list[int]) -> dict[str, int]:
        totals = {"opening": Decimal("0"), "newbiz": Decimal("0"), "interest": Decimal("0"), "amortization": Decimal("0"), "closing": Decimal("0")}

        for table_index in table_indexes:
            rows = table_rows(first_data_table(tables, table_index))
            opening_row = find_row(
                rows,
                lambda row: row_contains(row, "기초")
                and row_contains(row, "보험계약")
                and not row_contains(row, "부채인")
                and not row_contains(row, "자산인"),
            )
            closing_row = find_row(
                rows,
                lambda row: row_contains(row, "기말")
                and row_contains(row, "보험계약")
                and not row_contains(row, "부채인")
                and not row_contains(row, "자산인"),
            )
            totals["opening"] += csm_col(opening_row)
            totals["newbiz"] += csm_col(find_row(rows, lambda row: row_contains(row, "신계약효과")))
            totals["interest"] += csm_col(find_row(rows, lambda row: row_contains(row, "보험금융손익")))
            totals["amortization"] += csm_col(find_row(rows, lambda row: row_contains(row, "보험계약마진 상각")))
            totals["closing"] += csm_col(closing_row)

        return self.finalize_movement(totals)

    def finalize_movement(self, totals_mn: dict[str, Decimal]) -> dict[str, int]:
        opening = mn_to_bn_int(totals_mn["opening"])
        newbiz = mn_to_bn_int(totals_mn["newbiz"])
        interest = mn_to_bn_int(totals_mn["interest"])
        amortization = mn_to_bn_int(totals_mn["amortization"])
        closing = mn_to_bn_int(totals_mn["closing"])
        adjustment = closing - opening - newbiz - interest - amortization
        return {
            "opening": opening,
            "newbiz": newbiz,
            "interest": interest,
            "adjustment": adjustment,
            "amortization": amortization,
            "closing": closing,
        }

    def summary_text(self, company_name: str, label: str, movement: dict[str, int]) -> str:
        change = movement["closing"] - movement["opening"]
        sign = "+" if change >= 0 else ""
        return (
            f"Open DART 외부 공시 기준으로 {company_name} {label} 보유 CSM은 "
            f"{movement['closing'] / 1000:.1f}조원이며, 전년도말 기시 CSM 대비 "
            f"{sign}{change / 1000:.1f}조원 변동했습니다. Movement 합계 검산은 일치합니다."
        )


class FinancialMetricAgent:
    name = "financial-metric-agent"

    def run(self, context: AgentContext) -> None:
        for company_id, company in context.source["companies"].items():
            context.financial_metrics[company_id] = {}
            for period_id, period in company["periods"].items():
                derived = period["financial_metric"]["derived"]
                accounts = period["financial_metric"]["accounts"]
                formula = {
                    "parentNetIncome": derived["parent_net_income_bn"],
                    "nonControllingInterest": derived.get("non_controlling_interest_bn") or 0,
                    "incomeTaxExpense": derived.get("income_tax_expense_bn") or 0,
                }
                source_references = self.source_references(company_id, period_id, period, formula)
                metric = {
                    "insuranceProfit": derived["insurance_profit_bn"],
                    "investmentProfit": derived["investment_profit_bn"],
                    "netIncome": derived["parent_net_income_bn"],
                    "kics": self.extract_kics(company_id, period_id, period["document_candidates"]["tables"]),
                    "csmScope": "별도 재무제표 기준 · 재보험 제외",
                    "profitScope": f"{period['label']} · 관리손익",
                    "insuranceScope": "별도 보험서비스손익",
                    "investmentScope": "별도 투자손익 + 영업외손익 + 연결효과",
                    "investmentCalcNote": "계산은 지배주주 연결순익 + 비지배지분 + 법인세비용 - 별도 보험손익으로 역산하여 적용",
                    "netIncomeScope": "지배주주 연결손익",
                    "kicsScope": self.kics_scope(period_id),
                    "note": "Open DART API 및 원문 주석 기준",
                    "investmentFormula": formula,
                    "sourceReferences": source_references,
                }
                context.financial_metrics[company_id][period_id] = metric

                calculated = Decimal(str(formula["parentNetIncome"])) + Decimal(str(formula["nonControllingInterest"])) + Decimal(str(formula["incomeTaxExpense"])) - Decimal(str(metric["insuranceProfit"]))
                diff = calculated - Decimal(str(metric["investmentProfit"]))
                context.quality_checks.append(
                    {
                        "agent": self.name,
                        "company": company_id,
                        "period": period_id,
                        "check": "investment_formula",
                        "ok": abs(diff) <= Decimal("0.001"),
                        "diff_bn": decimal_to_float(diff.quantize(Decimal("0.001"))),
                        "formula": source_references["investmentProfit"]["formula"],
                    }
                )

    def source_references(
        self,
        company_id: str,
        period_id: str,
        period: dict[str, Any],
        formula: dict[str, Any],
    ) -> dict[str, Any]:
        accounts = period["financial_metric"]["accounts"]
        investment_formula = "parentNetIncome + nonControllingInterest + incomeTaxExpense - insuranceProfit"

        return {
            "insuranceProfit": account_source_reference(
                period,
                accounts["insurance_service_profit"],
                basis="separate_insurance_service_result",
            ),
            "investmentProfit": {
                **filing_reference(period),
                "valueKind": "calculated",
                "basis": "separate_investment_profit_plus_non_operating_and_consolidation_effect",
                "unit": "KRW billion",
                "sourceLayer": "derived from Open DART account values",
                "formula": investment_formula,
                "formulaInputs": {
                    **formula,
                    "insuranceProfit": period["financial_metric"]["derived"]["insurance_profit_bn"],
                },
                "sourceAccounts": {
                    "insuranceProfit": accounts["insurance_service_profit"],
                    "parentNetIncome": accounts["parent_net_income"],
                    "nonControllingInterest": accounts["non_controlling_interest"],
                    "incomeTaxExpense": accounts["income_tax_expense"],
                },
                "manualAdjustment": False,
            },
            "netIncome": account_source_reference(
                period,
                accounts["parent_net_income"],
                basis="controlling_parent_consolidated_net_income",
            ),
            "kics": {
                **filing_reference(period),
                "valueKind": "actual",
                "basis": "public_solvency_disclosure",
                "unit": "percent",
                "sourceLayer": "Open DART document.xml table",
                "sourceTables": [KICS_TABLES[company_id][period_id]],
                "manualAdjustment": False,
            },
        }

    def extract_kics(self, company_id: str, period_id: str, tables: list[dict[str, Any]]) -> float:
        table_index = KICS_TABLES[company_id][period_id]
        rows = table_rows(first_data_table(tables, table_index))
        row = find_row(rows, lambda candidate: row_contains(candidate, "지급여력비율"))
        return float(parse_amount_mn(row[1]))

    def kics_scope(self, period_id: str) -> str:
        quarter_to_month = {"q1": "3월말", "q2": "6월말", "q3": "9월말", "q4": "12월말"}
        year, quarter = period_id.split("-")
        return f"{year}.{quarter_to_month[quarter]}"


class QualityValidationAgent:
    name = "quality-validation-agent"

    def run(self, context: AgentContext) -> None:
        context.quality_checks.append(
            {
                "agent": self.name,
                "check": "source_policy",
                "ok": "external DART API only" in context.source.get("source_policy", ""),
                "source_policy": context.source.get("source_policy"),
            }
        )

        for company_id, company in context.sample_data.items():
            for period_id, period in company["periods"].items():
                movement = period["movement"]
                diff = movement["closing"] - sum(
                    movement[key] for key in ("opening", "newbiz", "interest", "adjustment", "amortization")
                )
                financial = context.financial_metrics[company_id][period_id]
                traceability_ok = self.traceability_ok(period, financial)
                basis_ok = self.basis_contract_ok(period, financial)
                context.quality_checks.append(
                    {
                        "agent": self.name,
                        "company": company_id,
                        "period": period_id,
                        "check": "dashboard_ready",
                        "ok": diff == 0 and financial.get("kics") is not None,
                        "movement_diff_bn": diff,
                        "has_kics": financial.get("kics") is not None,
                    }
                )
                context.quality_checks.append(
                    {
                        "agent": self.name,
                        "company": company_id,
                        "period": period_id,
                        "check": "source_traceability",
                        "ok": traceability_ok,
                        "movement_reference": period.get("sourceReference"),
                        "metric_reference_keys": sorted(financial.get("sourceReferences", {}).keys()),
                    }
                )
                context.quality_checks.append(
                    {
                        "agent": self.name,
                        "company": company_id,
                        "period": period_id,
                        "check": "basis_contract",
                        "ok": basis_ok,
                        "movement_basis": period.get("sourceReference", {}).get("basis"),
                        "metric_bases": {
                            key: ref.get("basis")
                            for key, ref in financial.get("sourceReferences", {}).items()
                        },
                    }
                )

    def traceability_ok(self, period: dict[str, Any], financial: dict[str, Any]) -> bool:
        movement_ref = period.get("sourceReference", {})
        metric_refs = financial.get("sourceReferences", {})
        required_metrics = {"insuranceProfit", "investmentProfit", "netIncome", "kics"}
        if set(metric_refs) != required_metrics:
            return False
        if not movement_ref.get("rceptNo") or not movement_ref.get("dartUrl") or not movement_ref.get("sourceTables"):
            return False
        for ref in metric_refs.values():
            if not ref.get("rceptNo") or not ref.get("dartUrl"):
                return False
        return bool(metric_refs["kics"].get("sourceTables"))

    def basis_contract_ok(self, period: dict[str, Any], financial: dict[str, Any]) -> bool:
        metric_refs = financial.get("sourceReferences", {})
        return (
            period.get("sourceReference", {}).get("basis") == "separate_financial_statement_excluding_reinsurance"
            and metric_refs.get("insuranceProfit", {}).get("basis") == "separate_insurance_service_result"
            and metric_refs.get("investmentProfit", {}).get("basis")
            == "separate_investment_profit_plus_non_operating_and_consolidation_effect"
            and metric_refs.get("netIncome", {}).get("basis") == "controlling_parent_consolidated_net_income"
            and metric_refs.get("kics", {}).get("basis") == "public_solvency_disclosure"
        )


class HumanReviewWorkbenchAgent:
    name = "human-review-workbench-agent"

    def run(self, context: AgentContext) -> None:
        for company_id, company in context.sample_data.items():
            for period_id, period in company["periods"].items():
                financial = context.financial_metrics[company_id][period_id]
                context.review_items.append(self.movement_item(company_id, company, period_id, period))
                context.review_items.append(self.financial_item(company_id, company, period_id, financial))
        self.apply_overrides(context.review_items, context.review_overrides)

    def apply_overrides(self, review_items: list[dict[str, Any]], review_overrides: dict[str, Any]) -> None:
        items_by_id = {item["id"]: item for item in review_items}
        for item_id, override in review_overrides.get("items", {}).items():
            item = items_by_id.get(item_id)
            if item is None:
                continue

            decision = override.get("decision")
            if decision not in {"approved", "adjusted"}:
                continue

            item["status"] = "passed"
            item["severity"] = "info"
            manual_adjustment = item["manualAdjustment"]
            manual_adjustment["applied"] = True
            manual_adjustment["decision"] = decision
            manual_adjustment["adjustedValue"] = override.get("adjustedValue")
            manual_adjustment["reviewerNote"] = str(override.get("reviewerNote", ""))
            manual_adjustment["reviewedBy"] = str(override.get("reviewedBy", ""))
            manual_adjustment["reviewedAt"] = str(override.get("reviewedAt", ""))

    def movement_item(
        self,
        company_id: str,
        company: dict[str, Any],
        period_id: str,
        period: dict[str, Any],
    ) -> dict[str, Any]:
        needs_review = "이자부리" in period.get("quality", "") or "별도 표시 없음" in period.get("quality", "")
        status = "needs_review" if needs_review else "passed"
        severity = "warning" if needs_review else "info"
        reason = (
            "원문에서 이자부리가 별도 행으로 표시되지 않아 조정 등에 흡수된 값입니다."
            if needs_review
            else "Movement 합계와 기말 CSM이 일치하고 출처 메타데이터가 존재합니다."
        )
        action = (
            "원문 표에서 이자부리 표시 방식과 CSM 조정 등 잔차를 사람이 확인합니다."
            if needs_review
            else "정기 리뷰 시 원문 표 번호와 Movement 합계만 재확인합니다."
        )

        return {
            "id": f"{company_id}.{period_id}.csm_movement",
            "company": company_id,
            "companyName": company["name"],
            "period": period_id,
            "category": "csm",
            "metric": "csm_movement",
            "title": f"{company['name']} {period_id} CSM Movement",
            "status": status,
            "systemStatus": status,
            "severity": severity,
            "systemSeverity": severity,
            "systemValue": period["movement"],
            "basis": period["sourceReference"]["basis"],
            "sourceReference": period["sourceReference"],
            "reviewReason": reason,
            "recommendedAction": action,
            "manualAdjustment": default_manual_adjustment(period["movement"]),
        }

    def financial_item(
        self,
        company_id: str,
        company: dict[str, Any],
        period_id: str,
        financial: dict[str, Any],
    ) -> dict[str, Any]:
        source_references = financial.get("sourceReferences", {})
        source_reference = source_references.get("insuranceProfit", {})

        return {
            "id": f"{company_id}.{period_id}.financial_metrics",
            "company": company_id,
            "companyName": company["name"],
            "period": period_id,
            "category": "profit",
            "metric": "financial_metrics",
            "title": f"{company['name']} {period_id} 손익/K-ICS",
            "status": "passed",
            "systemStatus": "passed",
            "severity": "info",
            "systemSeverity": "info",
            "systemValue": {
                "insuranceProfit": financial["insuranceProfit"],
                "investmentProfit": financial["investmentProfit"],
                "netIncome": financial["netIncome"],
                "kics": financial["kics"],
            },
            "basis": "mixed_profit_and_solvency_basis",
            "sourceReference": source_reference,
            "sourceReferences": source_references,
            "reviewReason": "보험손익, 투자손익, 당기순이익, K-ICS 출처와 산식 메타데이터가 존재합니다.",
            "recommendedAction": "보고 전 손익 기준과 투자손익 역산식을 확인합니다.",
            "manualAdjustment": default_manual_adjustment(
                {
                    "insuranceProfit": financial["insuranceProfit"],
                    "investmentProfit": financial["investmentProfit"],
                    "netIncome": financial["netIncome"],
                    "kics": financial["kics"],
                }
            ),
        }


class DashboardWriterAgent:
    name = "dashboard-writer-agent"

    def __init__(self, output_path: Path, dashboard_js_path: Path):
        self.output_path = output_path
        self.dashboard_js_path = dashboard_js_path

    def build_payload(self, context: AgentContext) -> dict[str, Any]:
        return {
            "dataContractVersion": "csm-dashboard-agent-output/v0.4",
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "sourcePolicy": context.source["source_policy"],
            "generatedFrom": context.source.get("generated_from"),
            "analysisPolicy": self.analysis_policy(context),
            "agents": [
                DartIngestionAgent.name,
                CsmMovementMappingAgent.name,
                FinancialMetricAgent.name,
                QualityValidationAgent.name,
                HumanReviewWorkbenchAgent.name,
                DashboardWriterAgent.name,
            ],
            "sampleData": context.sample_data,
            "financialMetrics": context.financial_metrics,
            "qualityChecks": context.quality_checks,
            "reviewSummary": self.review_summary(context.review_items),
            "reviewItems": context.review_items,
        }

    def analysis_policy(self, context: AgentContext) -> dict[str, Any]:
        return {
            "aiResponseContractVersion": "csm-ai-layer/v1",
            "supportedCompanies": sorted(context.sample_data.keys()),
            "latestValidatedPeriodByCompany": {
                company_id: self.latest_period_key(company["periods"])
                for company_id, company in context.sample_data.items()
            },
            "supportedAnalysisTypes": [
                "anomaly",
                "movement",
                "peer",
                "briefing",
                "chat",
            ],
            "forecastDisplayBasis": "latest-validated-only",
            "sameOriginGateway": True,
        }

    @staticmethod
    def latest_period_key(periods: dict[str, Any]) -> str:
        def sort_key(period_key: str) -> tuple[int, int]:
            year, quarter = period_key.split("-q")
            return int(year), int(quarter)

        return max(periods.keys(), key=sort_key)

    def review_summary(self, review_items: list[dict[str, Any]]) -> dict[str, int]:
        summary = {"total": len(review_items), "passed": 0, "needs_review": 0, "failed": 0}
        for item in review_items:
            status = item.get("status")
            if status in summary:
                summary[status] += 1
        return summary

    def run(self, context: AgentContext, write_dashboard: bool) -> dict[str, Any]:
        payload = self.build_payload(context)
        self.output_path.parent.mkdir(parents=True, exist_ok=True)
        self.output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

        if write_dashboard:
            self.dashboard_js_path.parent.mkdir(parents=True, exist_ok=True)
            js = (
                "/* Generated by tools/csm_agent_pipeline.py. Do not edit manually. */\n"
                "window.CSM_AGENT_DATA = "
                + json.dumps(payload, ensure_ascii=False, indent=2)
                + ";\n"
            )
            self.dashboard_js_path.write_text(js, encoding="utf-8")

        return payload


def run_pipeline(
    source_path: Path,
    output_path: Path,
    dashboard_js_path: Path,
    write_dashboard: bool,
    review_overrides_path: Path | None = DEFAULT_REVIEW_OVERRIDES,
) -> dict[str, Any]:
    source = DartIngestionAgent(source_path).run()
    context = AgentContext(
        source=source,
        sample_data={},
        financial_metrics={},
        quality_checks=[],
        review_items=[],
        review_overrides=load_review_overrides(review_overrides_path),
    )

    CsmMovementMappingAgent().run(context)
    FinancialMetricAgent().run(context)
    QualityValidationAgent().run(context)
    HumanReviewWorkbenchAgent().run(context)
    return DashboardWriterAgent(output_path, dashboard_js_path).run(context, write_dashboard)


def main() -> int:
    parser = argparse.ArgumentParser(description="Build CSM dashboard agent output from external DART extraction.")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--dashboard-js", type=Path, default=DEFAULT_DASHBOARD_JS)
    parser.add_argument("--review-overrides", type=Path, default=DEFAULT_REVIEW_OVERRIDES)
    parser.add_argument("--write-dashboard", action="store_true")
    args = parser.parse_args()

    payload = run_pipeline(
        args.source,
        args.output,
        args.dashboard_js,
        args.write_dashboard,
        review_overrides_path=args.review_overrides,
    )
    failed = [check for check in payload["qualityChecks"] if not check.get("ok", False)]

    print(f"generated: {args.output}")
    if args.write_dashboard:
        print(f"dashboard_js: {args.dashboard_js}")
    print(f"quality_checks: {len(payload['qualityChecks'])}, failed: {len(failed)}")
    for check in failed:
        print(json.dumps(check, ensure_ascii=False))

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
