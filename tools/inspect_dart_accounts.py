import json
import urllib.parse
import urllib.request
from pathlib import Path


ENV_PATH = Path(r"C:\Users\user\Desktop\codex_day2\.env")
API_KEY = [
    line.split("=", 1)[1].strip().strip("\"'")
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines()
    if line.startswith("API_K_DART=")
][0]

COMPANIES = [("00139214", "삼성화재"), ("00126256", "삼성생명")]
REPORTS = [("11013", "Q1"), ("11012", "Q2"), ("11014", "Q3"), ("11011", "Q4")]
KEYWORDS = [
    "보험서비스",
    "보험손익",
    "당기순이익",
    "당기순손익",
    "지배기업",
    "지배주주",
    "비지배",
    "법인세",
    "투자손익",
    "보험영업",
    "손익",
]


def fetch(corp_code, report_code, fs_div):
    params = urllib.parse.urlencode(
        {
            "crtfc_key": API_KEY,
            "corp_code": corp_code,
            "bsns_year": "2025",
            "reprt_code": report_code,
            "fs_div": fs_div,
        }
    )
    url = "https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json?" + params
    return json.loads(urllib.request.urlopen(url, timeout=60).read().decode("utf-8"))


for corp_code, company_name in COMPANIES:
    for report_code, label in REPORTS:
        print(f"\n## {company_name} {label}")
        for fs_div in ["OFS", "CFS"]:
            result = fetch(corp_code, report_code, fs_div)
            print(" ", fs_div, result.get("status"), result.get("message"))
            for row in result.get("list", []):
                account_name = row.get("account_nm", "")
                statement_name = row.get("sj_nm", "")
                if any(keyword in account_name or keyword in statement_name for keyword in KEYWORDS):
                    print(
                        "   ",
                        statement_name,
                        "|",
                        account_name,
                        "|",
                        row.get("thstrm_amount"),
                    )
