import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync("csm-prototype/index.html", "utf8");
const script = readFileSync("csm-prototype/script.js", "utf8");
const styles = readFileSync("csm-prototype/styles.css", "utf8");

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
assert.match(html, /id="agent-run-button"/, "agent run button should exist in index.html");
assert.match(html, /id="agent-timeline"/, "agent timeline container should exist in index.html");
assert.match(html, /id="agent-last-run-result"/, "agent run result meta should exist in index.html");
assert.match(html, /CSM Lens system/, "product title should use CSM Lens system");
assert.doesNotMatch(
  html,
  /<section class="shortcut-grid"/,
  "overview tab should not embed quick-jump cards that look like other tabs",
);
assert.doesNotMatch(
  html,
  /company-summary-panel/,
  "company analysis tab should not duplicate overview KPI summary cards at the top",
);

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
assert.match(
  script,
  /panel\.dataset\.activePanel = String\(isActive\)/,
  "top-level tab state should mark exactly one panel as active",
);
assert.match(
  script,
  /panel\.dataset\.activeSubpanel = String\(isActive\)/,
  "company subtab state should mark exactly one subpanel as active",
);
assert.match(
  styles,
  /\.tab-panel\[hidden\]/,
  "hidden top-level tab panels should be explicitly hidden by app CSS",
);
assert.match(
  styles,
  /\.ai-drawer\[data-open="true"\]/,
  "AI drawer should visibly open when the data-open state is true",
);
assert.match(
  styles,
  /#overview-panel:not\(\[hidden\]\)\s*\{\s*grid-template-rows:\s*auto auto auto;/,
  "overview tab should use auto-height rows so watch cards do not overlap the shortcut row",
);
assert.match(
  styles,
  /\.tab-panel\[data-active-panel="true"\]/,
  "active top-level tab panel should have an explicit visible state",
);
assert.match(
  styles,
  /\.company-subtab-panel\[data-active-subpanel="true"\]/,
  "active company subtab panel should have an explicit visible state",
);
assert.match(
  styles,
  /\.agent-timeline\b/,
  "agent timeline should have dedicated styling",
);
assert.match(
  styles,
  /\.agent-stage\[data-status="running"\]/,
  "running agent stage should have a visible state",
);
