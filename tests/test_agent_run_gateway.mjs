import assert from "node:assert/strict";
import test from "node:test";

import { createAgentRunGateway } from "../tools/agent-run-gateway.mjs";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("agent target list defaults to incomplete backlog targets only", async () => {
  const gateway = createAgentRunGateway({ stageDelayMs: 8 });

  const backlog = await gateway.listTargets();
  const allTargets = await gateway.listTargets({ includeCompleted: true });

  assert.equal(allTargets.targets.length, 117, "nine companies should expose 13 quarterly periods each");
  assert.equal(new Set(allTargets.targets.map((target) => target.companyKey)).size, 9);
  assert.equal(allTargets.summary.backlog + allTargets.summary.completed, 117);
  assert.equal(backlog.targets.length, allTargets.summary.backlog);
  assert.ok(backlog.targets.every((target) => target.status !== "completed"));
  assert.ok(
    backlog.targets.some(
      (target) => target.companyKey === "shinhan-life" && target.periodKey === "2026-q1",
    ),
    "material opening reconciliation differences should enter the backlog",
  );
});

test("agent run returns a validation-gated snapshot and finishes with no review when data is clean", async () => {
  const gateway = createAgentRunGateway({ stageDelayMs: 8 });

  await assert.rejects(
    () =>
      gateway.startRun({
        companyKey: "samsung-life",
        periodKey: "2026-q1",
      }),
    /completed target|already validated/i,
  );

  const started = await gateway.startRun({
    companyKey: "samsung-life",
    periodKey: "2026-q1",
    allowRerun: true,
  });

  assert.equal(started.status, "running");
  assert.equal(started.selectedCompany, "samsung-life");
  assert.equal(started.selectedPeriod, "2026-q1");
  assert.equal(started.stages[0].status, "running");
  assert.equal(started.stages[3].status, "idle");
  assert.equal(started.snapshot, null);

  await wait(34);
  const validationPassed = await gateway.getRun(started.runId);

  assert.ok(
    ["running", "completed"].includes(validationPassed.status),
    "run should still be active or just finished after validation becomes available",
  );
  assert.equal(validationPassed.stages[3].status, "completed");
  assert.ok(validationPassed.snapshot, "snapshot should be attached after validation");
  assert.equal(validationPassed.snapshot.sampleData["samsung-life"].name, "삼성생명");
  assert.equal(validationPassed.forecastContractVersion, "2026.08.16-v7.5");
  assert.equal(validationPassed.forecastRuntimeContractVersion, "csm-forecast-runtime/v1");
  assert.ok(validationPassed.forecastHash);
  assert.equal(validationPassed.forecast.independentModel, 14135);
  assert.equal(validationPassed.forecast.base, 13500);
  assert.equal(validationPassed.forecast.worst, 13040);
  assert.equal(validationPassed.forecast.targetAdjustmentOverlay, -635);
  assert.equal(validationPassed.forecast.adjustmentBeforeTargetOverlay, -1640);

  await wait(18);
  const finished = await gateway.getRun(started.runId);

  assert.equal(finished.status, "completed");
  assert.equal(finished.stages.at(-1).status, "not_required");
  assert.equal(finished.executionMode, "snapshot_revalidation");
  assert.match(finished.executionNote, /실시간 수집 배치를 실행하지 않습니다/);
  assert.match(finished.stages[0].label, /적재 원문 확인/);
  assert.match(finished.stages[0].message, /적재된 공시 원문 메타/);
  assert.match(finished.stages[1].message, /저장된 파싱 후보 표/);
  assert.match(finished.stages[3].message, /재검산/);
});

test("agent run surfaces a human review queue instead of auto-completing the final stage", async () => {
  const gateway = createAgentRunGateway({ stageDelayMs: 8 });

  const started = await gateway.startRun({
    companyKey: "shinhan-life",
    periodKey: "2026-q1",
  });

  await wait(52);
  const finished = await gateway.getRun(started.runId);

  assert.equal(finished.status, "completed");
  assert.equal(finished.stages.at(-1).status, "needs_review");
  assert.match(finished.stages.at(-1).message, /검토 큐 1건/);
  assert.ok(finished.snapshot, "validated snapshot should still be available before human review");
});

test("agent run rejects unsupported company-period requests", async () => {
  const gateway = createAgentRunGateway({ stageDelayMs: 8 });

  await assert.rejects(
    () =>
      gateway.startRun({
        companyKey: "not-a-company",
        periodKey: "2026-q1",
      }),
    /unsupported company/i,
  );

  await assert.rejects(
    () =>
      gateway.startRun({
        companyKey: "samsung-life",
        periodKey: "2025-ye",
      }),
    /unsupported period/i,
  );
});
