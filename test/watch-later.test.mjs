import test from "node:test";
import assert from "node:assert/strict";

import {
  fisherYatesSample,
  loadCompletePlaylist,
  moveSelectedVideos,
  runRandomWatchLaterToTop,
  validateCount,
} from "../skills/youtube-watch-later-random-to-top/scripts/watch-later.mjs";

test("validateCount accepts a positive integer", () => {
  assert.equal(validateCount("10"), 10);
});

test("validateCount rejects missing, zero, fractional, and non-numeric counts", () => {
  for (const value of [undefined, "", "0", "-1", "1.5", "ten"]) {
    assert.throws(() => validateCount(value), /positive integer/);
  }
});

test("fisherYatesSample preserves the shuffled movement sequence", () => {
  const candidates = [
    { id: "a", originalPosition: 1 },
    { id: "b", originalPosition: 2 },
    { id: "c", originalPosition: 3 },
    { id: "d", originalPosition: 4 },
  ];
  const draws = [0, 1, 0];

  const sample = fisherYatesSample(candidates, 3, () => draws.shift());

  assert.deepEqual(sample.map(({ id }) => id), ["c", "d", "b"]);
  assert.deepEqual(candidates.map(({ id }) => id), ["a", "b", "c", "d"]);
});

test("fisherYatesSample rejects a count larger than the candidate pool", () => {
  assert.throws(
    () => fisherYatesSample([{ id: "a" }], 2, () => 0),
    /only 1 eligible video/,
  );
});

test("loadCompletePlaylist deduplicates IDs and requires three stable bottom passes", async () => {
  const states = [
    {
      rows: [
        { id: "a", title: "Alpha", visibleIndex: "1" },
        { id: "b", title: "Beta", visibleIndex: "2" },
        null,
      ],
      atBottom: false,
    },
    {
      rows: [
        { id: "a", title: "Alpha duplicate", visibleIndex: "1" },
        { id: "b", title: "Beta", visibleIndex: "2" },
      ],
      atBottom: true,
    },
    {
      rows: [
        { id: "a", title: "Alpha", visibleIndex: "1" },
        { id: "b", title: "Beta", visibleIndex: "2" },
        { id: "c", title: "Gamma", visibleIndex: "3" },
      ],
      atBottom: true,
    },
    {
      rows: [
        { id: "a", title: "Alpha", visibleIndex: "1" },
        { id: "b", title: "Beta", visibleIndex: "2" },
        { id: "c", title: "Gamma", visibleIndex: "3" },
      ],
      atBottom: true,
    },
    {
      rows: [
        { id: "a", title: "Alpha", visibleIndex: "1" },
        { id: "b", title: "Beta", visibleIndex: "2" },
        { id: "c", title: "Gamma", visibleIndex: "3" },
      ],
      atBottom: true,
    },
    {
      rows: [
        { id: "a", title: "Alpha", visibleIndex: "1" },
        { id: "b", title: "Beta", visibleIndex: "2" },
        { id: "c", title: "Gamma", visibleIndex: "3" },
      ],
      atBottom: true,
    },
  ];
  let reads = 0;
  let scrolls = 0;
  const port = {
    async collectCandidates() {
      const state = states[reads];
      reads += 1;
      return state;
    },
    async scrollToLastRendered() {
      scrolls += 1;
    },
  };

  const candidates = await loadCompletePlaylist(port);

  assert.deepEqual(candidates, [
    { id: "a", title: "Alpha", originalPosition: 1 },
    { id: "b", title: "Beta", originalPosition: 2 },
    { id: "c", title: "Gamma", originalPosition: 3 },
  ]);
  assert.equal(reads, 6);
  assert.equal(scrolls, 5);
});

test("moveSelectedVideos preserves movement order and skips an already-first target", async () => {
  const selected = [
    { id: "a", title: "Alpha", originalPosition: 10 },
    { id: "b", title: "Beta", originalPosition: 20 },
    { id: "c", title: "Gamma", originalPosition: 30 },
  ];
  const firstIds = ["x", "b", "y"];
  const submitted = [];
  const port = {
    async currentFirstId() {
      return firstIds.shift();
    },
    async submitMoveToTop(id) {
      submitted.push(id);
    },
  };

  const outcome = await moveSelectedVideos(port, selected);

  assert.deepEqual(submitted, ["a", "c"]);
  assert.deepEqual(outcome.results.map(({ status }) => status), [
    "submitted",
    "already_first",
    "submitted",
  ]);
  assert.equal(outcome.failure, null);
  assert.deepEqual(outcome.untouched, []);
});

test("moveSelectedVideos stops after the first unsafe interaction failure", async () => {
  const selected = [
    { id: "a", title: "Alpha", originalPosition: 10 },
    { id: "b", title: "Beta", originalPosition: 20 },
    { id: "c", title: "Gamma", originalPosition: 30 },
  ];
  const attempted = [];
  const port = {
    async currentFirstId() {
      return "x";
    },
    async submitMoveToTop(id) {
      attempted.push(id);
      if (id === "b") {
        throw new Error("Move to top action was ambiguous");
      }
    },
  };

  const outcome = await moveSelectedVideos(port, selected);

  assert.deepEqual(attempted, ["a", "b"]);
  assert.deepEqual(outcome.results, [
    { target: selected[0], status: "submitted" },
  ]);
  assert.deepEqual(outcome.failure, {
    target: selected[1],
    reason: "Move to top action was ambiguous",
  });
  assert.deepEqual(outcome.untouched, [selected[2]]);
});

test("runRandomWatchLaterToTop loads, samples, and moves through the public port", async () => {
  const rows = [
    { id: "a", title: "Alpha", visibleIndex: "1" },
    { id: "b", title: "Beta", visibleIndex: "2" },
  ];
  const submitted = [];
  let opened = false;
  const port = {
    async openWatchLater() {
      opened = true;
    },
    async collectCandidates() {
      return { rows, atBottom: true };
    },
    async scrollToLastRendered() {},
    async currentFirstId() {
      return "a";
    },
    async submitMoveToTop(id) {
      submitted.push(id);
    },
  };

  const outcome = await runRandomWatchLaterToTop(null, 1, {
    port,
    draw: () => 0,
  });

  assert.equal(opened, true);
  assert.equal(outcome.eligibleCount, 2);
  assert.deepEqual(outcome.selected, [
    { id: "b", title: "Beta", originalPosition: 2 },
  ]);
  assert.deepEqual(submitted, ["b"]);
  assert.equal(outcome.failure, null);
});
