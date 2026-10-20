import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";

import { confirm } from "../src/confirm.mjs";

function ask(typed, { end = false } = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  let written = "";
  output.on("data", (chunk) => {
    written += chunk;
  });

  const answer = confirm("Continue? [y/N] ", { input, output });

  if (end) {
    input.end(typed);
  } else {
    input.write(typed);
  }

  return answer.then((value) => ({ value, written }));
}

test("confirm accepts y and yes in any case", async () => {
  for (const typed of ["y\n", "Y\n", "yes\n", " YES \n"]) {
    assert.equal((await ask(typed)).value, true, JSON.stringify(typed));
  }
});

test("confirm defaults to no", async () => {
  for (const typed of ["\n", "n\n", "no\n", "yep\n", "sure\n"]) {
    assert.equal((await ask(typed)).value, false, JSON.stringify(typed));
  }
});

test("confirm shows the question", async () => {
  assert.match((await ask("y\n")).written, /^Continue\? \[y\/N\] /);
});

test("confirm answers no when input ends before an answer", async () => {
  assert.equal((await ask("", { end: true })).value, false);
});
