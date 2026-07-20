import { randomInt } from "node:crypto";

export const WATCH_LATER_URL = "https://www.youtube.com/playlist?list=WL";

export function validateCount(value) {
  const count = typeof value === "number" ? value : Number(value);

  if (!Number.isInteger(count) || count <= 0) {
    throw new TypeError("count must be a positive integer");
  }

  return count;
}

export function fisherYatesSample(candidates, value, draw = randomInt) {
  const count = validateCount(value);

  if (count > candidates.length) {
    const noun = candidates.length === 1 ? "video" : "videos";
    throw new RangeError(
      `requested ${count}, but there are only ${candidates.length} eligible ${noun}`,
    );
  }

  const shuffled = candidates.slice();

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = draw(index + 1);

    if (!Number.isInteger(swapIndex) || swapIndex < 0 || swapIndex > index) {
      throw new RangeError(`random draw must be an integer from 0 to ${index}`);
    }

    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ];
  }

  return shuffled.slice(0, count);
}

function addCandidates(candidateMap, rows) {
  for (const row of rows) {
    if (!row?.id || candidateMap.has(row.id)) {
      continue;
    }

    const visiblePosition = Number.parseInt(row.visibleIndex, 10);
    candidateMap.set(row.id, {
      id: row.id,
      title: row.title,
      originalPosition: Number.isInteger(visiblePosition)
        ? visiblePosition
        : candidateMap.size + 1,
    });
  }
}

export async function loadCompletePlaylist(port, { maxPasses = 100 } = {}) {
  const candidateMap = new Map();
  const initial = await port.collectCandidates();
  addCandidates(candidateMap, initial.rows);

  let stableBottomPasses = 0;

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const sizeBeforeScroll = candidateMap.size;
    await port.scrollToLastRendered();
    const state = await port.collectCandidates();
    addCandidates(candidateMap, state.rows);

    const added = candidateMap.size - sizeBeforeScroll;
    stableBottomPasses = state.atBottom && added === 0
      ? stableBottomPasses + 1
      : 0;

    if (stableBottomPasses === 3) {
      return Array.from(candidateMap.values());
    }
  }

  throw new Error(`playlist did not stabilize after ${maxPasses} scroll passes`);
}

export async function moveSelectedVideos(port, selected) {
  const results = [];

  for (let index = 0; index < selected.length; index += 1) {
    const target = selected[index];

    try {
      if (await port.currentFirstId() === target.id) {
        results.push({ target, status: "already_first" });
        continue;
      }

      await port.submitMoveToTop(target.id);
      results.push({ target, status: "submitted" });
    } catch (error) {
      return {
        results,
        failure: {
          target,
          reason: error instanceof Error ? error.message : String(error),
        },
        untouched: selected.slice(index + 1),
      };
    }
  }

  return { results, failure: null, untouched: [] };
}

export function createYouTubeBrowserPort(
  tab,
  {
    scrollWaitMs = 800,
    settleWaitMs = 1_000,
    reacquirePasses = 8,
    menuPasses = 3,
  } = {},
) {
  if (!tab?.playwright || !tab?.dom_cua) {
    throw new TypeError("a Browser-plugin Tab is required");
  }

  const rowSelector = (id) => {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      throw new TypeError(`invalid canonical video ID: ${id}`);
    }

    return `ytd-playlist-video-renderer:has(a#video-title[href*="v=${id}"])`;
  };

  const resolveRow = async (id) => {
    const rows = tab.playwright.locator(rowSelector(id));
    const count = await rows.count();

    if (count === 1) {
      return rows;
    }

    if (count > 1) {
      const visibleRows = rows.filter({ visible: true });
      const visibleCount = await visibleRows.count();

      if (visibleCount === 1) {
        return visibleRows;
      }

      throw new Error(`target row is ambiguous for video ${id}`);
    }

    return null;
  };

  const collectCandidates = async () => tab.playwright.evaluate(() => {
    const rows = Array.from(
      document.querySelectorAll("ytd-playlist-video-renderer"),
    ).map((row) => {
      const link = row.querySelector("a#video-title");
      const href = link ? link.getAttribute("href") || "" : "";
      const match = href.match(/[?&]v=([^&]+)/);

      if (!match) {
        return null;
      }

      const index = row.querySelector("#index");
      return {
        id: match[1],
        title: (link.getAttribute("title") || link.textContent || "").trim(),
        visibleIndex: index ? (index.textContent || "").trim() : "",
      };
    }).filter(Boolean);

    const root = document.documentElement;
    return {
      rows,
      atBottom: window.scrollY + window.innerHeight >= root.scrollHeight - 5,
    };
  });

  const scrollToLastRendered = async () => {
    const rows = tab.playwright.locator("ytd-playlist-video-renderer");
    const count = await rows.count();

    if (count === 0) {
      throw new Error("Watch Later playlist items did not render");
    }

    const lastRow = rows.nth(count - 1);
    const rect = await lastRow.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return { top: bounds.top };
    });
    await tab.dom_cua.scroll({ x: 0, y: Math.max(1_200, rect.top - 220) });
    await tab.playwright.waitForTimeout(scrollWaitMs);
  };

  const reacquireRow = async (id) => {
    for (let pass = 0; pass < reacquirePasses; pass += 1) {
      await tab.playwright.domSnapshot();
      const row = await resolveRow(id);

      if (row) {
        return row;
      }

      await scrollToLastRendered();
    }

    throw new Error(`target row could not be reacquired for video ${id}`);
  };

  const scrollRowIntoView = async (row) => {
    const rect = await row.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return { top: bounds.top };
    });
    await tab.dom_cua.scroll({ x: 0, y: rect.top - 220 });
    await tab.playwright.waitForTimeout(scrollWaitMs);
  };

  return {
    async openWatchLater() {
      await tab.goto(WATCH_LATER_URL);
      await tab.playwright.waitForLoadState({
        state: "domcontentloaded",
        timeoutMs: 30_000,
      });

      for (let pass = 0; pass < 4; pass += 1) {
        const snapshot = await tab.playwright.domSnapshot();
        const url = await tab.url();
        const rows = tab.playwright.locator("ytd-playlist-video-renderer");
        const count = await rows.count();

        if (count > 0) {
          return;
        }

        if (
          /accounts\.google\.com|ServiceLogin/.test(url || "")
          || snapshot.includes('link "Sign in"')
        ) {
          throw new Error("authentication is required in the in-app Browser");
        }

        await tab.playwright.waitForTimeout(500);
      }

      throw new Error("Watch Later playlist items did not render");
    },

    collectCandidates,
    scrollToLastRendered,

    async currentFirstId() {
      return tab.playwright.evaluate(() => {
        const link = document.querySelector(
          "ytd-playlist-video-renderer a#video-title",
        );
        const href = link ? link.getAttribute("href") || "" : "";
        const match = href.match(/[?&]v=([^&]+)/);
        return match ? match[1] : null;
      });
    },

    async submitMoveToTop(id) {
      let row = await reacquireRow(id);
      await scrollRowIntoView(row);

      let menuButton = null;
      for (let pass = 0; pass < menuPasses; pass += 1) {
        await tab.playwright.domSnapshot();
        row = await resolveRow(id);

        if (!row) {
          await tab.playwright.waitForTimeout(500);
          continue;
        }

        const candidate = row.getByRole("button", {
          name: "Action menu",
          exact: true,
        });
        const count = await candidate.count();

        if (count === 1) {
          menuButton = candidate;
          break;
        }

        if (count > 1) {
          throw new Error(`row action menu is ambiguous for video ${id}`);
        }

        await tab.playwright.waitForTimeout(500);
      }

      if (!menuButton) {
        row = await reacquireRow(id);
        await scrollRowIntoView(row);
        await tab.playwright.domSnapshot();
        const candidate = row.getByRole("button", {
          name: "Action menu",
          exact: true,
        });
        const count = await candidate.count();

        if (count !== 1) {
          throw new Error(`row action menu is unavailable for video ${id}`);
        }

        menuButton = candidate;
      }

      await menuButton.click();

      let moveToTop = null;
      for (let pass = 0; pass < menuPasses; pass += 1) {
        const snapshot = await tab.playwright.domSnapshot();
        const candidate = tab.playwright
          .locator('ytd-menu-service-item-renderer[role="menuitem"]')
          .filter({ hasText: "Move to top" });
        const count = await candidate.count();

        if (snapshot.includes("Move to top") && count === 1) {
          moveToTop = candidate;
          break;
        }

        if (count > 1) {
          throw new Error(`Move to top action is ambiguous for video ${id}`);
        }

        await tab.playwright.waitForTimeout(300);
      }

      if (!moveToTop) {
        throw new Error(`Move to top action is unavailable for video ${id}`);
      }

      await moveToTop.click();
      await moveToTop.waitFor({ state: "hidden", timeoutMs: 5_000 });
      await tab.playwright.waitForTimeout(settleWaitMs);
    },
  };
}

export async function runRandomWatchLaterToTop(
  tab,
  value,
  { port, draw = randomInt, loadOptions } = {},
) {
  const count = validateCount(value);
  const runtimePort = port ?? createYouTubeBrowserPort(tab);

  await runtimePort.openWatchLater();
  const candidates = await loadCompletePlaylist(runtimePort, loadOptions);
  const selected = fisherYatesSample(candidates, count, draw);
  const movement = await moveSelectedVideos(runtimePort, selected);

  return {
    eligibleCount: candidates.length,
    selected,
    ...movement,
  };
}
