import assert from "node:assert/strict";
import test from "node:test";

import { createAgentRunGateway } from "../tools/agent-run-gateway.mjs";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("agent target list defaults to incomplete backlog targets only", async () => {
  const gateway = createAgentRunGateway({ stageDelayMs: 8 });

  const result = await gateway.listTargets();

  assert.equal(result.targets.length, 1);
  assert.equal(result.targets[0].companyKey, "samsung-fire");
  assert.equal(result.targets[0].periodKey, "2025-q1");
  assert.equal(result.targets[0].status, "needs_review");
  assert.equal(result.summary.backlog, 1);
  assert.equal(result.summary.completed, 7);
});

test("agent run returns a validation-gated snapshot and finishes with no review when data is clean", async () => {
  const gateway = createAgentRunGateway({ stageDelayMs: 8 });

  await assert.rejects(
    () =>
      gateway.startRun({
        companyKey: "samsung-life",
        periodKey: "2025-q4",
      }),
    /completed target|already validated/i,
  );

  const started = await gateway.startRun({
    companyKey: "samsung-life",
    periodKey: "2025-q4",
    allowRerun: true,
  });

  assert.equal(started.status, "running");
  assert.equal(started.selectedCompany, "samsung-life");
  assert.equal(started.selectedPeriod, "2025-q4");
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

  await wait(18);
  const finished = await gateway.getRun(started.runId);

  assert.equal(finished.status, "completed");
  assert.equal(finished.stages.at(-1).status, "not_required");
  assert.match(finished.stages[0].message, /공시 원문/);
  assert.match(finished.stages[1].message, /후보 표/);
  assert.match(finished.stages[3].message, /합계|검산/);
});

test("agent run surfaces a human review queue instead of auto-completing the final stage", async () => {
  const gateway = createAgentRunGateway({ stageDelayMs: 8 });

  const started = await gateway.startRun({
    companyKey: "samsung-fire",
    periodKey: "2025-q1",
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
        companyKey: "hanwha-life",
        periodKey: "2025-q4",
      }),
    /unsupported company/i,
  );

  await assert.rejects(
    () =>
      gateway.startRun({
        companyKey: "samsung-life",
        periodKey: "2024-q4",
      }),
    /unsupported period/i,
  );
});
