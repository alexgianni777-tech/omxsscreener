import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("Telegram workflow passes pasted text through an environment variable and jq JSON encoding", () => {
  const workflow = readFileSync(new URL("../../../../.github/workflows/screener-import.yml", import.meta.url), "utf8");
  assert.match(workflow, /SCREENER_TEXT:\s*\$\{\{\s*inputs\.screener_text\s*\}\}/);
  assert.match(workflow, /jq -n --arg text "\$SCREENER_TEXT" '\{text:\$text\}'/);
  assert.match(workflow, /--data-binary/);
  assert.match(workflow, /\$\{DASHBOARD_URL%\/\}/);
  assert.doesNotMatch(workflow, /run:[\s\S]*?\$\{\{\s*inputs\.screener_text\s*\}\}/);
});
