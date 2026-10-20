#!/usr/bin/env node
import { parseArgs, styleText } from "node:util";

import { readYouTubeCookies } from "../src/chrome-cookies.mjs";
import { confirm } from "../src/confirm.mjs";
import { openWatchLater } from "../src/innertube.mjs";
import {
  fisherYatesSample,
  moveSelectedVideos,
  validateCount,
} from "../src/watch-later.mjs";

const ALWAYS_ALLOW_WARNING = styleText(
  ["bold", "red"],
  `⚠️  Do not click Always Allow. If you do, any program on your Mac can read
    this key without asking, and the key decrypts all your Chrome cookies.`,
  { stream: process.stderr },
);

const KEYCHAIN_NOTICE = `wl-random needs your YouTube session from Chrome to access your
Watch Later playlist. Chrome encrypts its cookies with a key that it keeps in
the macOS Keychain. To read that key, wl-random runs the macOS "security"
tool, so macOS will ask:

  security wants to use your confidential information stored in
  "Chrome Safe Storage" in your keychain.

Enter your Mac login password and click Allow.

${ALWAYS_ALLOW_WARNING}

wl-random decrypts only the youtube.com cookies, sends them only to
www.youtube.com, and does not save them.

`;

class Cancelled extends Error {}

const HELP = `Usage: wl-random <count> [options]

Move <count> random videos from your YouTube Watch Later playlist to the top.
Reads your YouTube session from Google Chrome on macOS. No browser opens.

Options:
  --dry-run          Load and sample the playlist, but move nothing
  --json             Print the outcome as JSON
  --profile <name>   Chrome profile directory (default: "Default")
  -y, --yes          Do not ask before reading the Chrome key from the Keychain
  -h, --help         Show this help

Examples:
  wl-random 10
  wl-random 10 --dry-run --json
  wl-random 5 --profile "Profile 1"

Exit codes:
  0  success
  1  error or "no" answer before any video moved
  2  usage error, or no terminal to ask in and no --yes
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
      yes: { type: "boolean", short: "y", default: false },
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
    yes: values.yes,
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

async function beforeKeychainRead(options) {
  process.stderr.write(KEYCHAIN_NOTICE);

  if (!options.yes && !(await confirm("Continue? [y/N] "))) {
    throw new Cancelled();
  }
}

async function run(options) {
  const client = await openWatchLater(
    await readYouTubeCookies({
      profile: options.profile,
      beforeKeychainRead: () => beforeKeychainRead(options),
    }),
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

  if (!options.yes && !process.stdin.isTTY) {
    console.error(
      "error: wl-random asks before it reads the Chrome key, but stdin is not"
        + " a terminal. Run it with --yes to skip the question.",
    );
    return 2;
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
    if (error instanceof Cancelled) {
      console.error(
        "Cancelled. wl-random did not read the Keychain or change your playlist.",
      );
    } else {
      console.error(`error: ${error.message}`);
    }

    return 1;
  }
}

process.exitCode = await main();
