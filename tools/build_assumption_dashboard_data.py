# -*- coding: utf-8 -*-
"""Build insurance-assumption dashboard data solely from Open DART notes."""

from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "external-data" / "insurance-assumption-dashboard-data.json"
JS_OUTPUT = ROOT / "csm-prototype" / "assumption-data.generated.js"
DURATION_BUCKETS = [
    "1년",
    "2년",
    "3년",
    "4년",
    "5년",
    "6년",
    "7년",
    "8년",
    "9년",
    "10년",
    "11~15년",
    "16~20년",
    "21~25년",
    "26~30년",
    "31년 이후",
]
CLAIM_SOURCE_TABLES = {
    "samsung-life": {"2024": ("2025", 284), "2025": ("2025", 284)},
    "hanwha-life": {"2024": ("2025", 169), "2025": ("2025", 169)},
    "kyobo-life": {"2024": ("2024", 246), "2025": ("2025", 384)},
    "shinhan-life": {"2024": ("2025", 347), "2025": ("2025", 347)},
    "samsung-fire": {"2024": ("2025", 175), "2025": ("2025", 170)},
    "meritz-fire": {"2024": ("2025", 586), "2025": ("2025", 579)},
    "db-insurance": {"2024": ("2025", 253), "2025": ("2025", 251)},
    "hyundai-marine": {"2024": ("2025", 579), "2025": ("2025", 578)},
    "kb-insurance": {"2024": ("2025", 208), "2025": ("2025", 207)},
}
SOURCE_TABLES = {
    "samsung-life": {"loss": [286], "expense": [288]},
    "hanwha-life": {"loss": [170], "expense": [172]},
    "kyobo-life": {"loss": [257], "expense": [258]},
    "shinhan-life": {"loss": [343], "expense": [349]},
    "samsung-fire": {"loss": [172], "expense": [174]},
    "meritz-fire": {"loss": [581], "expense": [584]},
    "db-insurance": {"loss": [245], "expense": [255]},
    "hyundai-marine": {"loss": [581, 583], "expense": [585, 587]},
    "kb-insurance": {"loss": [209, 210], "expense": [213, 214]},
}
PRIOR_SOURCE_TABLES = {
    "samsung-life": {"loss": [252], "expense": [254]},
    "hanwha-life": {"loss": [169], "expense": [173]},
    "kyobo-life": {"loss": [247], "expense": [248]},
    "shinhan-life": {"loss": [322], "expense": [328]},
    "samsung-fire": {"loss": [48], "expense": [50]},
    "meritz-fire": {"loss": [511], "expense": [514]},
    "db-insurance": {"loss": [705], "expense": [708]},
    "hyundai-marine": {"loss": [510], "expense": [512]},
    "kb-insurance": {"loss": [294], "expense": [295]},
}


def as_number(value):
    if value in (None, "", "-", "#NAME?", "#DIV/0!"):
        return None
    if isinstance(value, (int, float)):
        return float(value) if math.isfinite(float(value)) else None
    cleaned = str(value).replace(",", "").replace("\xa0", "").strip()
    negative = cleaned.startswith("(") and cleaned.endswith(")")
    cleaned = cleaned.strip("()").replace("%", "")
    try:
        number = float(cleaned)
        return -number if negative else number
    except ValueError:
        return None


def as_percent(value):
    number = as_number(value)
    if number is None:
        return None
    return round(number * 100 if abs(number) <= 3 else number, 2)


def full_numeric_cells(row: list[str]) -> list[float]:
    values = []
    for cell in row:
        text = str(cell).strip()
        if re.fullmatch(r"\(?-?[\d,]+(?:\.\d+)?%?\)?", text):
            value = as_number(text)
            if value is not None:
                values.append(value)
    return values


def aggregate_from_candidate(candidate: dict) -> dict | None:
    rows = candidate["rows"]
    for index, row in enumerate(rows):
        label = "".join(str(cell) for cell in row[:3]).replace(" ", "")
        if "합계" not in label:
            continue
        start = index if len(full_numeric_cells(row)) == 16 else index + 1
        if start + 2 >= len(rows):
            continue
        first = full_numeric_cells(rows[start])
        second = full_numeric_cells(rows[start + 1])
        ratios = full_numeric_cells(rows[start + 2])
        if len(first) == len(second) == len(ratios) == 16:
            return {
                "first": {"duration": first[:15], "presentValue": first[15]},
                "second": {"duration": second[:15], "presentValue": second[15]},
                "ratio": {"duration": ratios[:15], "presentValue": ratios[15]},
                "tableIndexes": [candidate["tableIndex"]],
            }
    return None


def aggregate_detail_candidate(candidate: dict, first_label: str, second_label: str) -> dict | None:
    """Aggregate company totals when DART only discloses portfolio detail rows."""
    first_rows = []
    second_rows = []
    for row in candidate["rows"]:
        label = "".join(str(cell) for cell in row[:3]).replace(" ", "")
        numeric = full_numeric_cells(row)
        if len(numeric) != 16:
            continue
        if first_label in label:
            first_rows.append(numeric)
        elif second_label in label:
            second_rows.append(numeric)
    if not first_rows or not second_rows:
        return None
    first = [sum(values) for values in zip(*first_rows)]
    second = [sum(values) for values in zip(*second_rows)]
    ratio = [round(a / b * 100, 2) if b else None for a, b in zip(first, second)]
    return {
        "first": {"duration": first[:15], "presentValue": first[15]},
        "second": {"duration": second[:15], "presentValue": second[15]},
        "ratio": {"duration": ratio[:15], "presentValue": ratio[15]},
        "tableIndexes": [candidate["tableIndex"]],
    }


def aggregate_segment_candidate(candidate: dict, first_label: str, second_label: str) -> dict | None:
    """Read a horizontally split DART total-table segment."""
    rows = candidate["rows"]
    for index, row in enumerate(rows):
        label = "".join(str(cell) for cell in row[:3]).replace(" ", "")
        if "합계" not in label or first_label not in label or index + 1 >= len(rows):
            continue
        first = full_numeric_cells(row)
        second_row = rows[index + 1]
        second_label_text = "".join(str(cell) for cell in second_row[:3]).replace(" ", "")
        second = full_numeric_cells(second_row)
        if second_label not in second_label_text or not first or len(first) != len(second):
            continue
        return {"firstSegment": first, "secondSegment": second, "tableIndexes": [candidate["tableIndex"]]}
    return None


def source_unit(candidate: dict) -> tuple[str, float]:
    text = candidate.get("context", "") + " " + " ".join(" ".join(map(str, row)) for row in candidate["rows"])
    matches = re.findall(r"단위\s*[:：]?\s*([^\s,%)]+)", text)
    unit = matches[-1] if matches else ""
    if "억원" in unit:
        return "억원", 1
    if "백만원" in unit:
        return "백만원", 0.01
    if "천원" in unit:
        return "천원", 0.00001
    if unit == "원" or " 원" in text[-300:]:
        return "원", 0.00000001
    peak = max((abs(value) for row in candidate["rows"] for value in full_numeric_cells(row)), default=0)
    if peak > 1e11:
        return "원", 0.00000001
    if peak > 1e8:
        return "천원", 0.00001
    return "백만원", 0.01


def combine_metrics(metrics: list[dict]) -> dict:
    def combined_values(key):
        duration = [round(sum(metric[key]["duration"][index] for metric in metrics), 2) for index in range(15)]
        present_value = round(sum(metric[key]["presentValue"] for metric in metrics), 2)
        return {"duration": duration, "presentValue": present_value}

    first = combined_values("first")
    second = combined_values("second")
    ratio_duration = [round(a / b * 100, 2) if b else None for a, b in zip(first["duration"], second["duration"])]
    ratio_present = round(first["presentValue"] / second["presentValue"] * 100, 2) if second["presentValue"] else None
    return {
        "first": first,
        "second": second,
        "ratio": {"duration": ratio_duration, "presentValue": ratio_present},
        "tableIndexes": [index for metric in metrics for index in metric["tableIndexes"]],
        "sourceUnits": [unit for metric in metrics for unit in metric["sourceUnits"]],
    }


def combine_segments(segments: list[dict]) -> dict:
    first_values = [value for segment in segments for value in segment["firstSegment"]]
    second_values = [value for segment in segments for value in segment["secondSegment"]]
    if len(first_values) != 16 or len(second_values) != 16:
        raise ValueError(f"DART split duration table should contain 16 values, found {len(first_values)}")
    first = {"duration": first_values[:15], "presentValue": first_values[15]}
    second = {"duration": second_values[:15], "presentValue": second_values[15]}
    ratio = {
        "duration": [round(a / b * 100, 2) if b else None for a, b in zip(first["duration"], second["duration"])],
        "presentValue": round(first["presentValue"] / second["presentValue"] * 100, 2) if second["presentValue"] else None,
    }
    return {
        "first": first, "second": second, "ratio": ratio,
        "tableIndexes": [index for segment in segments for index in segment["tableIndexes"]],
        "sourceUnits": [unit for segment in segments for unit in segment["sourceUnits"]],
    }


def metric_from_dart(company: dict, metric_key: str, table_indexes: list[int]) -> dict:
    candidates = company["candidates"][metric_key]
    first_label, second_label = (
        ("예상보험금", "위험보험료")
        if metric_key == "loss_ratio_by_duration"
        else ("예상유지비", "예정유지비")
    )
    parsed_metrics = []
    parsed_segments = []
    for table_index in table_indexes:
        matches = [candidate for candidate in candidates if candidate["tableIndex"] == table_index]
        current_matches = [candidate for candidate in matches if "당기말" in "".join("".join(map(str, row)) for row in candidate["rows"][:3])]
        for candidate in current_matches or matches:
            parsed = aggregate_from_candidate(candidate)
            parsed = parsed or aggregate_detail_candidate(candidate, first_label, second_label)
            unit, factor = source_unit(candidate)
            if parsed:
                parsed = scale_amount_metric(parsed, factor)
                parsed["sourceUnits"] = [unit]
                parsed_metrics.append(parsed)
                break
            segment = aggregate_segment_candidate(candidate, first_label, second_label)
            if segment:
                segment["firstSegment"] = [round(value * factor, 2) for value in segment["firstSegment"]]
                segment["secondSegment"] = [round(value * factor, 2) for value in segment["secondSegment"]]
                segment["sourceUnits"] = [unit]
                parsed_segments.append(segment)
                break
    if parsed_segments and len(parsed_segments) == len(table_indexes):
        return combine_segments(parsed_segments)
    if len(parsed_metrics) != len(table_indexes):
        raise ValueError(f"DART duration metric not found: {company['name']} {metric_key} {table_indexes}")
    return combine_metrics(parsed_metrics)


def claim_from_dart(company: dict, table_index: int, target_year: str, report_year: str) -> dict:
    candidate = next(
        item for item in company["candidates"]["claim_experience"] if item["tableIndex"] == table_index
    )
    expected_row = next((row for row in candidate["rows"] if "예상손해율" in "".join(map(str, row)) and full_numeric_cells(row)), None)
    actual_row = next((row for row in candidate["rows"] if "실제손해율" in "".join(map(str, row)) and full_numeric_cells(row)), None)
    variance_row = next((row for row in candidate["rows"] if "예실차" in "".join(map(str, row)) and full_numeric_cells(row)), None)

    def payload(expected, actual, disclosed_variance=None):
        calculated = round(expected - actual, 2)
        variance = round(disclosed_variance, 2) if disclosed_variance is not None else calculated
        return {
            "expectedLossRatio": round(expected, 2),
            "actualLossRatio": round(actual, 2),
            "variance": variance,
            "calculatedVariance": calculated,
            "formulaDifference": round(variance - calculated, 2),
        }

    if expected_row and actual_row:
        expected_values = full_numeric_cells(expected_row)
        actual_values = full_numeric_cells(actual_row)
        variance_values = full_numeric_cells(variance_row) if variance_row else []
        index = 0 if target_year == report_year else 1
        if index < min(len(expected_values), len(actual_values)):
            expected, actual = expected_values[index], actual_values[index]
            disclosed = variance_values[index] if index < len(variance_values) else None
            return payload(expected, actual, disclosed)

    labelled = {}
    unlabelled = []
    for row in candidate["rows"]:
        values = full_numeric_cells(row)
        if len(values) < 2:
            continue
        expected, actual = values[:2]
        disclosed = values[2] if len(values) >= 3 else None
        label = "".join(map(str, row[:-2])).replace(" ", "")
        if "당기" in label:
            labelled[report_year] = (expected, actual, disclosed)
        elif "전기" in label:
            labelled[str(int(report_year) - 1)] = (expected, actual, disclosed)
        else:
            unlabelled.append((expected, actual, disclosed))
    pair = labelled.get(target_year) or (unlabelled[0] if len(unlabelled) == 1 else None)
    if not pair:
        raise ValueError(f"DART claim metric not found: {company['name']} table {table_index} year {target_year}")
    expected, actual, disclosed = pair
    return payload(expected, actual, disclosed)


def scale_amount_metric(metric: dict, factor: float) -> dict:
    for key in ("first", "second"):
        metric[key]["duration"] = [round(value * factor, 2) if value is not None else None for value in metric[key]["duration"]]
        value = metric[key]["presentValue"]
        metric[key]["presentValue"] = round(value * factor, 2) if value is not None else None
    return metric


def source_reference(company: dict, metric: str, source_tables: list[int], period: str = "2025년말") -> dict:
    return {
        "sourceType": "Open DART",
        "reportName": company["report"]["report_name"],
        "rceptNo": company["report"]["rcept_no"],
        "dartUrl": company["report"]["dart_url"],
        "basis": "연결재무제표 주석 · 발행한 보험계약 · 합계",
        "metric": metric,
        "period": period,
        "sourceTables": source_tables,
        "extractionMethod": "Open DART 연결 주석의 지정 표를 직접 추출하고, 합계가 없으면 세부 포트폴리오 행을 합산",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dart-json", type=Path, required=True)
    parser.add_argument("--dart-prior-json", type=Path)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--js-output", type=Path, default=JS_OUTPUT)
    args = parser.parse_args()

    dart = json.loads(args.dart_json.read_text(encoding="utf-8"))
    dart_prior = json.loads(args.dart_prior_json.read_text(encoding="utf-8")) if args.dart_prior_json else None
    if not dart_prior:
        raise ValueError("--dart-prior-json is required for the 2024 annual disclosure")

    output = {
        "schemaVersion": "insurance-assumption-dashboard/v3",
        "availablePeriods": ["2024-ye", "2025-ye"],
        "durationBuckets": DURATION_BUCKETS,
        "sourcePolicy": "Open DART annual-report consolidated notes are the sole source and validation basis",
        "companies": {},
    }
    for key in SOURCE_TABLES:
        dart_company = dart["companies"][key]
        claim = {}
        claim_tables = {}
        for year in ("2024", "2025"):
            report_year, table_index = CLAIM_SOURCE_TABLES[key][year]
            source_company = dart_company if report_year == "2025" else dart_prior["companies"][key]
            claim[year] = claim_from_dart(source_company, table_index, year, report_year)
            claim_tables[year] = {"reportYear": report_year, "tableIndex": table_index}

        loss = metric_from_dart(dart_company, "loss_ratio_by_duration", SOURCE_TABLES[key]["loss"])
        expense = metric_from_dart(dart_company, "expense_ratio_by_duration", SOURCE_TABLES[key]["expense"])

        prior_company = dart_prior["companies"][key] if dart_prior else None
        prior_loss = metric_from_dart(prior_company, "loss_ratio_by_duration", PRIOR_SOURCE_TABLES[key]["loss"])
        prior_expense = metric_from_dart(prior_company, "expense_ratio_by_duration", PRIOR_SOURCE_TABLES[key]["expense"])

        current_loss_payload = {
            "expectedClaims": loss["first"],
            "riskPremium": loss["second"],
            "ratio": loss["ratio"],
            "unit": "억원",
            "sourceReference": source_reference(dart_company, "위험보험료 대비 예상보험금", SOURCE_TABLES[key]["loss"]),
        }
        current_expense_payload = {
            "expectedExpense": expense["first"],
            "expectedMaintenanceExpense": expense["second"],
            "ratio": expense["ratio"],
            "unit": "억원",
            "sourceReference": source_reference(dart_company, "예정유지비 대비 예상유지비", SOURCE_TABLES[key]["expense"]),
        }
        prior_loss_payload = {
            "expectedClaims": prior_loss["first"],
            "riskPremium": prior_loss["second"],
            "ratio": prior_loss["ratio"],
            "unit": "억원",
            "sourceReference": source_reference(prior_company, "위험보험료 대비 예상보험금", PRIOR_SOURCE_TABLES[key]["loss"], "2024년말"),
        }
        prior_expense_payload = {
            "expectedExpense": prior_expense["first"],
            "expectedMaintenanceExpense": prior_expense["second"],
            "ratio": prior_expense["ratio"],
            "unit": "억원",
            "sourceReference": source_reference(prior_company, "예정유지비 대비 예상유지비", PRIOR_SOURCE_TABLES[key]["expense"], "2024년말"),
        }

        output["companies"][key] = {
            "name": dart_company["name"],
            "sector": dart_company["sector"],
            "claimExperience": {
                "values": claim,
                "sourceReference": source_reference(dart_company, "보험금 예실차 비율", []),
                "checks": {
                    "formula": "variance = expectedLossRatio - actualLossRatio",
                    "status": "passed" if all(
                        abs(value["formulaDifference"]) <= 0.02
                        for value in claim.values()
                    ) else "needs_review",
                },
            },
            "lossRatioByDuration": {"periods": {"2024-ye": prior_loss_payload, "2025-ye": current_loss_payload}},
            "expenseRatioByDuration": {"periods": {"2024-ye": prior_expense_payload, "2025-ye": current_expense_payload}},
        }
        output["companies"][key]["claimExperience"]["sourceReference"]["sourceTables"] = claim_tables
        if dart_prior:
            prior_report = dart_prior["companies"][key]["report"]
            output["companies"][key]["claimExperience"]["sourceReference"]["comparativeReport"] = {
                "reportName": prior_report["report_name"],
                "rceptNo": prior_report["rcept_no"],
                "dartUrl": prior_report["dart_url"],
            }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(output, ensure_ascii=False, indent=2)
    args.output.write_text(serialized, encoding="utf-8")
    args.js_output.parent.mkdir(parents=True, exist_ok=True)
    args.js_output.write_text(f"window.CSM_ASSUMPTION_DATA = {serialized};\n", encoding="utf-8")
    print(args.output)
    print(args.js_output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
