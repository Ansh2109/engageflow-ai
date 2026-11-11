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
  assert.match(page, /if \(type === "comment_to_dm"\)/);
  assert.match(page, /if \(type === "dm_keyword"\)/);
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

test("Comment-to-DM builder uses the existing media API and cursor pagination", () => {
  const builder = readFileSync(
    new URL(
      "../src/app/(dashboard)/automations/new/comment-to-dm-builder.tsx",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(builder, /\/api\/instagram\/media\?\$\{query\}/);
  assert.match(builder, /new URLSearchParams\(\{ accountId, after: nextCursor \}\)/);
  assert.match(builder, /setMedia\(\(current\) =>/);
  assert.match(builder, /paginationGuard\.current\.isCurrent\(request\)/);
  assert.match(builder, /paginationGuard\.current\.finish\(request\)/);
  assert.match(builder, /paginationGuard\.current\.reset\(\)/);
  assert.match(builder, /Select \$\{item\.mediaType/);
  assert.match(builder, /aria-pressed=\{selected\}/);
  assert.match(builder, /selectedAccount\?\.name/);
  assert.match(builder, /account\.name/);
});

test("Comment-to-DM controls remain preview-only and do not persist or send", () => {
  const builder = readFileSync(
    new URL(
      "../src/app/(dashboard)/automations/new/comment-to-dm-builder.tsx",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(builder, /Backend integration pending/);
  assert.match(builder, /Preview only\./);
  assert.match(builder, /\{\{username\}\}/);
  assert.match(builder, /\{\{first_name\}\}/);
  assert.match(builder, /\{\{account_name\}\}/);
  assert.doesNotMatch(builder, /method:\s*["']POST["']/i);
  assert.doesNotMatch(builder, /\/api\/instagram\/(?:comment-reply|automations)/);
});
