# -*- coding: utf-8 -*-
"""Extract insurance-assumption tables from annual DART consolidated notes."""

from __future__ import annotations

import argparse
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from io import BytesIO
from pathlib import Path

from lxml import html


ROOT = Path(__file__).resolve().parents[1]
ANNUAL_EXTRACT = ROOT / "external-data" / "dart-annual-insurance-extract.json"
DEFAULT_OUTPUT = ROOT / "external-data" / "dart-assumption-metrics-2025.json"


def load_key() -> str:
    key = os.getenv("API_K_DART")
    if key:
        return key
    env_path = ROOT / ".env"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            if line.startswith("API_K_DART="):
                return line.split("=", 1)[1].strip().strip("\"'")
    raise RuntimeError("API_K_DART is missing")


def fetch_document(api_key: str, rcept_no: str) -> bytes:
    query = urllib.parse.urlencode({"crtfc_key": api_key, "rcept_no": rcept_no})
    request = urllib.request.Request(
        f"https://opendart.fss.or.kr/api/document.xml?{query}",
        headers={"User-Agent": "CSM-Lens/1.0"},
    )
    last_error = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return response.read()
        except (TimeoutError, urllib.error.URLError) as error:
            last_error = error
            if attempt < 2:
                time.sleep(attempt + 1)
    raise last_error


def document_parts(payload: bytes, rcept_no: str) -> list[tuple[str, bytes]]:
    try:
        with zipfile.ZipFile(BytesIO(payload)) as archive:
            return [
                (name, archive.read(name))
                for name in archive.namelist()
                if name.lower().endswith((".xml", ".html", ".htm"))
            ]
    except zipfile.BadZipFile:
        return [(f"{rcept_no}.xml", payload)]


def normalize(value: str | None) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def numeric_count(text: str) -> int:
    return len(re.findall(r"(?<![가-힣A-Za-z])\(?-?\d[\d,]*(?:\.\d+)?\)?", text))


def table_rows(table) -> list[list[str]]:
    rows = []
    for tr in table.xpath(".//tr"):
        cells = [normalize(cell.text_content()) for cell in tr.xpath("./th|./td|./te")]
        cells = [cell for cell in cells if cell]
        if cells:
            rows.append(cells)
    return rows


def classify_table(text: str) -> str | None:
    compact = text.replace(" ", "")
    assumption_term_count = sum(
        term in compact for term in ("해지율", "위험률", "위험율", "사업비율", "기타가정")
    )
    if (
        "가정변경효과" in compact
        and "보험계약마진" in compact
        and assumption_term_count >= 2
        and numeric_count(text) >= 12
    ):
        return "liability_assumption"
    if (
        ("보험계약마진" in compact or "가정변경효과" in compact)
        and assumption_term_count >= 2
        and numeric_count(text) >= 12
    ):
        return "liability_assumption_partial"
    if "예상손해율" in compact and "실제손해율" in compact and numeric_count(text) >= 2:
        return "claim_experience"
    if "예상보험금" in compact and numeric_count(text) >= 15:
        return "loss_ratio_by_duration"
    if "예상유지비" in compact and numeric_count(text) >= 15:
        return "expense_ratio_by_duration"
    return None


def extract_candidates(payload: bytes, rcept_no: str) -> dict[str, list[dict]]:
    result = {
        "claim_experience": [],
        "loss_ratio_by_duration": [],
        "expense_ratio_by_duration": [],
        "liability_assumption": [],
        "liability_assumption_partial": [],
    }
    for document, raw in document_parts(payload, rcept_no):
        try:
            root = html.fromstring(raw)
        except Exception:
            continue
        prior_texts: list[str] = []
        for table_index, table in enumerate(root.xpath(".//table")):
            text = normalize(table.text_content())
            metric = classify_table(text)
            if metric:
                context = " | ".join(prior_texts[-18:])[-3000:]
                result[metric].append(
                    {
                        "document": document,
                        "tableIndex": table_index,
                        "context": context,
                        "rows": table_rows(table),
                    }
                )
            if text:
                prior_texts.append(text[:1000])
    return result


def liability_keyword_evidence(payload: bytes, rcept_no: str) -> dict[str, int]:
    """Count source-document terms so a zero candidate can be distinguished from a classifier miss."""
    texts = []
    for _, raw in document_parts(payload, rcept_no):
        try:
            texts.append(normalize(html.fromstring(raw).text_content()).replace(" ", ""))
        except Exception:
            continue
    combined = " ".join(texts)
    return {
        term: combined.count(term)
        for term in ("가정변경효과", "보험계약마진추정의변경", "해지율가정", "위험률가정", "위험율가정")
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--year", default="2025")
    args = parser.parse_args()
    api_key = load_key()
    annual = json.loads(ANNUAL_EXTRACT.read_text(encoding="utf-8"))
    output = {
        "schemaVersion": "dart-assumption-metrics/v1",
        "period": f"{args.year}-ye",
        "sourcePolicy": "Open DART annual report consolidated notes",
        "companies": {},
    }
    for company_key, company in annual["companies"].items():
        report = company["years"][args.year]["report"]
        print(f"extracting {company['name']} {report['rcept_no']}", flush=True)
        payload = fetch_document(api_key, report["rcept_no"])
        output["companies"][company_key] = {
            "name": company["name"],
            "sector": company["sector"],
            "corpCode": company["corp_code"],
            "report": report,
            "liabilityKeywordEvidence": liability_keyword_evidence(payload, report["rcept_no"]),
            "candidates": extract_candidates(payload, report["rcept_no"]),
        }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
