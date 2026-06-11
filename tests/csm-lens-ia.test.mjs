import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync("csm-prototype/index.html", "utf8");
const script = readFileSync("csm-prototype/script.js", "utf8");

const requiredTabs = ["overview", "company-analysis", "market", "forecast", "quality"];
const requiredCompanySubtabs = ["movement", "profit", "portfolio", "trend"];

requiredTabs.forEach((tab) => {
  assert.match(
    html,
    new RegExp(`data-tab="${tab}"`),
    `top-level tab ${tab} should exist in index.html`,
  );
  assert.match(
    html,
    new RegExp(`data-tab-panel="${tab}"`),
    `tab panel ${tab} should exist in index.html`,
  );
});

requiredCompanySubtabs.forEach((tab) => {
  assert.match(
    html,
    new RegExp(`data-company-subtab="${tab}"`),
    `company subtab ${tab} should exist in index.html`,
  );
  assert.match(
    html,
    new RegExp(`data-company-subtab-panel="${tab}"`),
    `company subtab panel ${tab} should exist in index.html`,
  );
});

assert.match(html, /id="ai-drawer"/, "AI drawer should exist in index.html");
assert.match(html, /id="company-select"/, "company selector should exist in index.html");
assert.match(html, /id="period-select"/, "period selector should exist in index.html");

assert.match(
  script,
  /activeTab:\s*parseHashTab\(window\.location\.hash\)/,
  "script should initialize activeTab from URL hash",
);
assert.match(
  script,
  /activeCompanySubtab:\s*"movement"/,
  "script should initialize a company analysis subtab",
);
assert.match(script, /function setActiveTab\(/, "script should expose setActiveTab");
assert.match(
  script,
  /function setActiveCompanySubtab\(/,
  "script should expose setActiveCompanySubtab",
);
