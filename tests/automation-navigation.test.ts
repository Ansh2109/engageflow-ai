import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(
  new URL("../src/app/(dashboard)/automations/new/page.tsx", import.meta.url),
  "utf8"
);

test("automation type cards navigate to distinct typed destinations", () => {
  assert.match(page, /href="\/automations\/new\?type=comment_to_dm"/);
  assert.match(page, /href="\/automations\/new\?type=dm_keyword"/);
  assert.match(page, /type === "comment_to_dm" \|\| type === "dm_keyword"/);
  assert.match(page, /Create \{selectedType\.title\} automation/);
});

test("automation cards remain whole-card keyboard-accessible native links", () => {
  assert.match(page, /return \(\s*<Link/);
  assert.match(page, /cursor-pointer/);
  assert.match(page, /focus-visible:ring-2/);
  assert.doesNotMatch(page, /onClick=/);
  assert.doesNotMatch(page, /<button[^>]*>[\s\S]*<Link/);
});

test("unimplemented automation setup is described without a fake form", () => {
  assert.match(page, /Automation setup is not available yet/);
  assert.match(page, /No automation will be saved\s+or activated/);
  assert.doesNotMatch(page, /<form/);
});
