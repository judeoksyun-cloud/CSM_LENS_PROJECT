# -*- coding: utf-8 -*-
"""Collect 2022-2025 year-end insurance disclosures for the CSM dashboard."""

from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.parse
import urllib.error
import urllib.request
import zipfile
from decimal import Decimal, InvalidOperation
from io import BytesIO
from pathlib import Path

from lxml import html


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "external-data" / "dart-annual-insurance-extract.json"
YEARS = (2022, 2023, 2024, 2025)
COMPANIES = {
    "samsung-life": {"name": "삼성생명", "sector": "생명보험", "corp_code": "00126256"},
    "hanwha-life": {"name": "한화생명", "sector": "생명보험", "corp_code": "00113058"},
    "kyobo-life": {"name": "교보생명", "sector": "생명보험", "corp_code": "00112882"},
    "shinhan-life": {"name": "신한라이프", "sector": "생명보험", "corp_code": "00137517"},
    "samsung-fire": {"name": "삼성화재", "sector": "손해보험", "corp_code": "00139214"},
    "meritz-fire": {"name": "메리츠화재", "sector": "손해보험", "corp_code": "00117744"},
    "db-insurance": {"name": "DB손해보험", "sector": "손해보험", "corp_code": "00159102"},
    "hyundai-marine": {"name": "현대해상", "sector": "손해보험", "corp_code": "00164973"},
    "kb-insurance": {"name": "KB손해보험", "sector": "손해보험", "corp_code": "00120216"},
}
KEYWORDS = ("보험계약마진", "계약서비스마진", "CSM", "지급여력비율", "K-ICS")


def load_key() -> str:
    key = os.getenv("API_K_DART")
    if key:
        return key
    env = ROOT / ".env"
    for line in env.read_text(encoding="utf-8").splitlines():
        if line.startswith("API_K_DART="):
            return line.split("=", 1)[1].strip().strip("\"'")
    raise RuntimeError("API_K_DART is missing")


API_KEY = load_key()


def fetch_bytes(endpoint: str, params: dict[str, str]) -> bytes:
    query = urllib.parse.urlencode({"crtfc_key": API_KEY, **params})
    request = urllib.request.Request(
        f"https://opendart.fss.or.kr/api/{endpoint}?{query}",
        headers={"User-Agent": "CSM-Lens/1.0"},
    )
    last_error = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                return response.read()
        except (TimeoutError, urllib.error.URLError) as error:
            last_error = error
            if attempt < 2:
                time.sleep(1 + attempt)
    raise last_error


def fetch_json(endpoint: str, params: dict[str, str]) -> dict:
    return json.loads(fetch_bytes(endpoint, params).decode("utf-8"))


def compact(value: str | None) -> str:
    return re.sub(r"\s+", "", value or "")


def normalize(value: str | None) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def amount_bn(value: str | None) -> float | None:
    if value in (None, "", "-"):
        return None
    try:
        return float((Decimal(str(value).replace(",", "")) / Decimal("1000000000")).quantize(Decimal("0.001")))
    except (InvalidOperation, ValueError):
        return None


def find_account(rows: list[dict], predicate) -> dict | None:
    for row in rows:
        if amount_bn(row.get("thstrm_amount")) is None:
            continue
        if predicate(compact(row.get("account_nm"))):
            return {
                "account_nm": row.get("account_nm"),
                "raw_amount": row.get("thstrm_amount"),
                "amount_bn": amount_bn(row.get("thstrm_amount")),
                "prior_raw_amount": row.get("frmtrm_amount"),
                "prior_amount_bn": amount_bn(row.get("frmtrm_amount")),
                "sj_nm": row.get("sj_nm"),
                "account_detail": row.get("account_detail"),
            }
    return None


def accounts(corp_code: str, year: int, fs_div: str) -> list[dict]:
    result = fetch_json(
        "fnlttSinglAcntAll.json",
        {"corp_code": corp_code, "bsns_year": str(year), "reprt_code": "11011", "fs_div": fs_div},
    )
    return result.get("list", []) if result.get("status") == "000" else []


def financial_metrics(corp_code: str, year: int) -> dict:
    ofs = accounts(corp_code, year, "OFS")
    cfs = accounts(corp_code, year, "CFS")
    insurance = find_account(ofs, lambda n: n in {"보험서비스손익", "보험서비스결과", "보험손익"})
    parent = find_account(
        cfs,
        lambda n: (
            "포괄" not in n
            and "순이익" in n
            and (
                ("지배기업" in n and ("소유주" in n or "지분" in n))
                or "지배주주" in n
                or "지배기업주주" in n
            )
        ),
    )
    if parent is None:
        parent = find_account(
            cfs,
            lambda n: n in {"당기순이익", "당기순이익(손실)"},
        )
        detailed_candidates = [
            row
            for row in cfs
            if row.get("sj_div") == "SCE"
            and "지배기업의소유주에게귀속되는지분" in compact(row.get("account_detail"))
            and amount_bn(row.get("thstrm_amount")) is not None
            and compact(row.get("account_nm")) in {"당기순이익", "당기순이익(손실)"}
        ]
        detailed_parent = max(
            detailed_candidates,
            key=lambda row: abs(amount_bn(row.get("thstrm_amount")) or 0),
            default=None,
        )
        if detailed_parent:
            parent = {
                "account_nm": detailed_parent.get("account_nm"),
                "raw_amount": detailed_parent.get("thstrm_amount"),
                "amount_bn": amount_bn(detailed_parent.get("thstrm_amount")),
                "prior_raw_amount": detailed_parent.get("frmtrm_amount"),
                "prior_amount_bn": amount_bn(detailed_parent.get("frmtrm_amount")),
                "sj_nm": detailed_parent.get("sj_nm"),
                "account_detail": detailed_parent.get("account_detail"),
            }
    nci = find_account(cfs, lambda n: "포괄" not in n and "비지배지분" in n and "순이익" in n)
    tax = find_account(cfs, lambda n: "법인세비용" in n and "차감전" not in n)
    return {
        "insurance_profit": insurance,
        "parent_net_income": parent,
        "non_controlling_interest": nci,
        "income_tax_expense": tax,
    }


def annual_report(corp_code: str, year: int) -> dict | None:
    result = fetch_json(
        "list.json",
        {
            "corp_code": corp_code,
            "bgn_de": f"{year + 1}0101",
            "end_de": f"{year + 1}1231",
            "last_reprt_at": "N",
            "pblntf_detail_ty": "A001",
            "page_count": "100",
        },
    )
    candidates = [
        item
        for item in result.get("list", [])
        if "사업보고서" in item.get("report_nm", "") and f"({year}.12)" in item.get("report_nm", "")
    ]
    if not candidates:
        return None
    # 첨부정정 공시는 본문 없이 정정 첨부만 반환되는 경우가 있어 원 공시를 우선한다.
    originals = [item for item in candidates if item.get("report_nm", "").startswith("사업보고서")]
    item = sorted(originals or candidates, key=lambda row: row.get("rcept_dt", ""))[0]
    return {
        "rcept_no": item["rcept_no"],
        "report_name": item["report_nm"],
        "rcept_dt": item["rcept_dt"],
        "dart_url": f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={item['rcept_no']}",
    }


def document_parts(rcept_no: str) -> list[tuple[str, bytes]]:
    payload = fetch_bytes("document.xml", {"rcept_no": rcept_no})
    try:
        with zipfile.ZipFile(BytesIO(payload)) as archive:
            return [
                (name, archive.read(name))
                for name in archive.namelist()
                if name.lower().endswith((".xml", ".html", ".htm"))
            ]
    except zipfile.BadZipFile:
        return [(f"{rcept_no}.xml", payload)]


def candidate_tables(rcept_no: str) -> list[dict]:
    found = []
    for document, payload in document_parts(rcept_no):
        try:
            root = html.fromstring(payload)
        except Exception:
            continue
        tables = list(root.xpath(".//table"))
        texts = [normalize(table.text_content()) for table in tables]
        focus = set()
        for index, text in enumerate(texts):
            if any(keyword.lower() in text.lower() for keyword in KEYWORDS):
                focus.update(range(max(0, index - 1), min(len(tables), index + 5)))
        for index in sorted(focus):
            rows = []
            for tr in tables[index].xpath(".//tr"):
                cells = [normalize(cell.text_content()) for cell in tr.xpath("./th|./td|./te")]
                cells = [cell for cell in cells if cell]
                if cells:
                    rows.append(cells)
            if rows:
                found.append(
                    {
                        "document": document,
                        "table_index": index,
                        "context": " | ".join(texts[max(0, index - 3):index])[-1000:],
                        "rows": rows[:100],
                    }
                )
    return found[:600]


def main() -> int:
    financial_only = "--financial-only" in sys.argv
    if financial_only:
        output = json.loads(OUT.read_text(encoding="utf-8"))
        for company_key, meta in COMPANIES.items():
            for year in YEARS:
                print(f"refreshing financials {meta['name']} {year}", flush=True)
                output["companies"][company_key]["years"][str(year)]["financial_metrics"] = (
                    financial_metrics(meta["corp_code"], year)
                )
        OUT.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
        print(OUT)
        return 0

    output = {
        "contract": "csm-annual-dart-extract/v1",
        "source_policy": "Open DART API only",
        "period_basis": "year-end-only",
        "years": list(YEARS),
        "companies": {},
    }
    for company_key, meta in COMPANIES.items():
        company = {**meta, "years": {}}
        output["companies"][company_key] = company
        for year in YEARS:
            print(f"collecting {meta['name']} {year}", flush=True)
            report = annual_report(meta["corp_code"], year)
            company["years"][str(year)] = {
                "report": report,
                "financial_metrics": financial_metrics(meta["corp_code"], year),
                "document_candidates": candidate_tables(report["rcept_no"]) if report else [],
            }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(OUT)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
