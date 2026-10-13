#!/usr/bin/env node
import { parseArgs } from "node:util";

import { readYouTubeCookies } from "../src/chrome-cookies.mjs";
import { openWatchLater } from "../src/innertube.mjs";
import {
  fisherYatesSample,
  moveSelectedVideos,
  validateCount,
} from "../src/watch-later.mjs";

const HELP = `Usage: wl-random <count> [options]

Move <count> random videos from your YouTube Watch Later playlist to the top.
Reads your YouTube session from Google Chrome on macOS. No browser opens.

Options:
  --dry-run          Load and sample the playlist, but move nothing
  --json             Print the outcome as JSON
  --profile <name>   Chrome profile directory (default: "Default")
  -h, --help         Show this help

Examples:
  wl-random 10
  wl-random 10 --dry-run --json
  wl-random 5 --profile "Profile 1"

Exit codes:
  0  success
  1  error before any video moved
  2  usage error
  3  stopped after a move failed; earlier moves were applied
`;

function parseCli(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      "dry-run": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      profile: { type: "string", default: "Default" },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) {
    return { help: true };
  }

  if (positionals.length !== 1) {
    throw new TypeError("expected exactly one <count> argument");
  }

  return {
    count: validateCount(positionals[0]),
    dryRun: values["dry-run"],
    json: values.json,
    profile: values.profile,
  };
}

function describe(video) {
  return `#${video.originalPosition} ${video.title}`;
}

function printOutcome(outcome) {
  const { eligibleCount, selected, dryRun } = outcome;
  console.log(
    `Selected ${selected.length} of ${eligibleCount} videos. Movement order:`,
  );

  if (dryRun) {
    selected.forEach((video, index) => {
      console.log(`  ${index + 1}. ${describe(video)} (dry run, not moved)`);
    });
    return;
  }

  const labels = { submitted: "moved", already_first: "already first" };
  outcome.results.forEach(({ target, status }, index) => {
    console.log(`  ${index + 1}. ${describe(target)} (${labels[status]})`);
  });

  if (outcome.failure) {
    const { target, reason } = outcome.failure;
    console.log(`  Failed: ${describe(target)}: ${reason}`);
    console.log(`  Not attempted: ${outcome.untouched.length}`);
  }
}

async function run(options) {
  const client = await openWatchLater(
    await readYouTubeCookies({ profile: options.profile }),
  );
  const items = await client.loadPlaylist();
  const movable = new Map(
    items.filter((item) => item.moveToTop).map((item) => [item.id, item]),
  );
  const candidates = Array.from(movable.values(), (item) => ({
    id: item.id,
    title: item.title,
    originalPosition: item.originalPosition,
  }));
  const selected = fisherYatesSample(candidates, options.count);

  if (options.dryRun) {
    return { dryRun: true, eligibleCount: candidates.length, selected };
  }

  let firstId = items[0]?.id ?? null;
  const movement = await moveSelectedVideos({
    async currentFirstId() {
      return firstId;
    },
    async submitMoveToTop(id) {
      await client.moveToTop(movable.get(id));
      firstId = id;
    },
  }, selected);

  return {
    dryRun: false,
    eligibleCount: candidates.length,
    selected,
    ...movement,
  };
}

async function main() {
  let options;

  try {
    options = parseCli(process.argv.slice(2));
  } catch (error) {
    console.error(`error: ${error.message}\n\n${HELP}`);
    return 2;
  }

  if (options.help) {
    console.log(HELP);
    return 0;
  }

  try {
    const outcome = await run(options);

    if (options.json) {
      console.log(JSON.stringify(outcome, null, 2));
    } else {
      printOutcome(outcome);
    }

    return outcome.failure ? 3 : 0;
  } catch (error) {
    console.error(`error: ${error.message}`);
    return 1;
  }
}

process.exitCode = await main();
