# -*- coding: utf-8 -*-
import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PIPELINE_PATH = ROOT / "tools" / "csm_agent_pipeline.py"

spec = importlib.util.spec_from_file_location("csm_agent_pipeline", PIPELINE_PATH)
pipeline = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules["csm_agent_pipeline"] = pipeline
spec.loader.exec_module(pipeline)


class CsmAgentPipelineMetadataTest(unittest.TestCase):
    def build_payload(self, overrides=None):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            overrides_path = None
            if overrides is not None:
                overrides_path = tmp / "manual-review-overrides.json"
                overrides_path.write_text(
                    pipeline.json.dumps(overrides, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
            return pipeline.run_pipeline(
                pipeline.DEFAULT_SOURCE,
                tmp / "agent-output.json",
                tmp / "dashboard-data.generated.js",
                write_dashboard=True,
                review_overrides_path=overrides_path,
            )

    def test_periods_keep_source_reference_for_movement_values(self):
        payload = self.build_payload()

        for company_id, company in payload["sampleData"].items():
            for period_id, period in company["periods"].items():
                with self.subTest(company=company_id, period=period_id):
                    reference = period["sourceReference"]

                    self.assertEqual(reference["sourceType"], "Open DART")
                    self.assertEqual(reference["valueKind"], "actual")
                    self.assertEqual(reference["basis"], "separate_financial_statement_excluding_reinsurance")
                    self.assertEqual(reference["unit"], "KRW billion")
                    self.assertFalse(reference["manualAdjustment"])
                    self.assertTrue(reference["sourceTables"])
                    self.assertIn(reference["rceptNo"], reference["dartUrl"])

    def test_financial_metrics_keep_metric_level_source_references(self):
        payload = self.build_payload()
        required = {"insuranceProfit", "investmentProfit", "netIncome", "kics"}

        for company_id, periods in payload["financialMetrics"].items():
            for period_id, metric in periods.items():
                with self.subTest(company=company_id, period=period_id):
                    references = metric["sourceReferences"]

                    self.assertEqual(set(references), required)
                    self.assertEqual(references["insuranceProfit"]["basis"], "separate_insurance_service_result")
                    self.assertIn("account", references["insuranceProfit"])
                    self.assertIn("raw_amount", references["insuranceProfit"]["account"])
                    self.assertEqual(references["investmentProfit"]["valueKind"], "calculated")
                    self.assertEqual(
                        references["investmentProfit"]["formula"],
                        "parentNetIncome + nonControllingInterest + incomeTaxExpense - insuranceProfit",
                    )
                    self.assertTrue(references["kics"]["sourceTables"])
                    self.assertEqual(references["kics"]["unit"], "percent")

    def test_quality_checks_cover_traceability_and_basis_contract(self):
        payload = self.build_payload()
        checks = payload["qualityChecks"]
        check_names = {check["check"] for check in checks}

        self.assertIn("source_traceability", check_names)
        self.assertIn("basis_contract", check_names)
        self.assertTrue(all(check["ok"] for check in checks))

    def test_dashboard_payload_includes_ai_analysis_policy(self):
        payload = self.build_payload()
        policy = payload["analysisPolicy"]

        self.assertEqual(payload["dataContractVersion"], "csm-dashboard-agent-output/v0.4")
        self.assertEqual(policy["aiResponseContractVersion"], "csm-ai-layer/v1")
        self.assertTrue(policy["sameOriginGateway"])
        self.assertEqual(policy["forecastDisplayBasis"], "latest-validated-only")
        self.assertEqual(policy["latestValidatedPeriodByCompany"]["samsung-life"], "2025-q4")
        self.assertEqual(policy["latestValidatedPeriodByCompany"]["samsung-fire"], "2025-q4")
        self.assertIn("briefing", policy["supportedAnalysisTypes"])

    def test_review_items_prepare_human_review_queue(self):
        payload = self.build_payload()
        review_items = payload["reviewItems"]

        self.assertGreaterEqual(len(review_items), 16)
        required_fields = {
            "id",
            "company",
            "period",
            "category",
            "metric",
            "title",
            "status",
            "severity",
            "systemValue",
            "basis",
            "sourceReference",
            "reviewReason",
            "recommendedAction",
            "manualAdjustment",
        }

        for item in review_items:
            with self.subTest(item=item["id"]):
                self.assertTrue(required_fields.issubset(item.keys()))
                self.assertIn(item["status"], {"passed", "needs_review", "failed"})
                self.assertIn(item["severity"], {"info", "warning", "error"})
                self.assertIn("applied", item["manualAdjustment"])
                self.assertFalse(item["manualAdjustment"]["applied"])
                self.assertIn("rceptNo", item["sourceReference"])
                self.assertIn("dartUrl", item["sourceReference"])

        fire_q1_movement = [
            item
            for item in review_items
            if item["company"] == "samsung-fire"
            and item["period"] == "2025-q1"
            and item["metric"] == "csm_movement"
        ]
        self.assertEqual(len(fire_q1_movement), 1)
        self.assertEqual(fire_q1_movement[0]["status"], "needs_review")
        self.assertIn("이자부리", fire_q1_movement[0]["reviewReason"])

    def test_manual_review_overrides_update_review_queue_state(self):
        payload = self.build_payload(
            {
                "items": {
                    "samsung-fire.2025-q1.csm_movement": {
                        "decision": "approved",
                        "reviewedBy": "qa-user",
                        "reviewedAt": "2026-06-11T09:00:00+09:00",
                        "reviewerNote": "원문 표 기준으로 이자부리 흡수 표시를 승인합니다.",
                    },
                    "samsung-life.2025-q4.financial_metrics": {
                        "decision": "adjusted",
                        "reviewedBy": "qa-user",
                        "reviewedAt": "2026-06-11T09:30:00+09:00",
                        "reviewerNote": "보고용 주석을 붙이기 위해 검토 완료 처리합니다.",
                        "adjustedValue": {
                            "investmentProfit": 2021.629,
                        },
                    },
                }
            }
        )

        summary = payload["reviewSummary"]
        self.assertEqual(summary["needs_review"], 0)

        items = {item["id"]: item for item in payload["reviewItems"]}
        fire_item = items["samsung-fire.2025-q1.csm_movement"]
        life_item = items["samsung-life.2025-q4.financial_metrics"]

        self.assertEqual(fire_item["status"], "passed")
        self.assertEqual(fire_item["systemStatus"], "needs_review")
        self.assertTrue(fire_item["manualAdjustment"]["applied"])
        self.assertEqual(fire_item["manualAdjustment"]["decision"], "approved")
        self.assertEqual(fire_item["manualAdjustment"]["reviewedBy"], "qa-user")
        self.assertEqual(
            fire_item["manualAdjustment"]["reviewerNote"],
            "원문 표 기준으로 이자부리 흡수 표시를 승인합니다.",
        )

        self.assertEqual(life_item["status"], "passed")
        self.assertEqual(life_item["manualAdjustment"]["decision"], "adjusted")
        self.assertEqual(
            life_item["manualAdjustment"]["adjustedValue"]["investmentProfit"],
            2021.629,
        )
        self.assertEqual(
            life_item["manualAdjustment"]["reviewedAt"],
            "2026-06-11T09:30:00+09:00",
        )


if __name__ == "__main__":
    unittest.main()
