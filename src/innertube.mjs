import { createHash } from "node:crypto";

export const YOUTUBE_ORIGIN = "https://www.youtube.com";
export const WATCH_LATER_URL = `${YOUTUBE_ORIGIN}/playlist?list=WL`;

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
  + "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36";

// Chrome rejects these characters in cookies, so one here means a bad decrypt.
const CONTROL_CHARACTER = /[\x00-\x08\x0A-\x1F\x7F]/;

export function cookieHeader(cookies) {
  return Array.from(cookies, ([name, value]) => {
    // Fetch would quote the whole header, with every cookie, in its error.
    if (CONTROL_CHARACTER.test(value)) {
      throw new Error(`cookie ${name} has a control character in its value`);
    }

    return `${name}=${value}`;
  }).join("; ");
}

export function sapisidHash(secret, origin, now = Date.now()) {
  const timestamp = Math.floor(now / 1_000);
  const digest = createHash("sha1")
    .update(`${timestamp} ${secret} ${origin}`)
    .digest("hex");
  return `${timestamp}_${digest}`;
}

export function authorizationHeader(
  cookies,
  origin = YOUTUBE_ORIGIN,
  now = Date.now(),
) {
  const sapisid = cookies.get("SAPISID") ?? cookies.get("__Secure-3PAPISID");

  if (!sapisid) {
    throw new Error(
      "YouTube session cookies are missing; sign in to YouTube in Chrome",
    );
  }

  const parts = [`SAPISIDHASH ${sapisidHash(sapisid, origin, now)}`];

  for (const [scheme, name] of [
    ["SAPISID1PHASH", "__Secure-1PAPISID"],
    ["SAPISID3PHASH", "__Secure-3PAPISID"],
  ]) {
    if (cookies.has(name)) {
      parts.push(`${scheme} ${sapisidHash(cookies.get(name), origin, now)}`);
    }
  }

  return parts.join(" ");
}

// Returns the balanced JSON object that starts at the first "{" after marker.
export function extractJsonObject(source, marker, fromIndex = 0) {
  const markerIndex = source.indexOf(marker, fromIndex);

  if (markerIndex === -1) {
    return null;
  }

  const start = source.indexOf("{", markerIndex + marker.length);
  let depth = 0;
  let inString = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];

    if (inString) {
      if (char === "\\") {
        index += 1;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;

      if (depth === 0) {
        return JSON.parse(source.slice(start, index + 1));
      }
    }
  }

  throw new Error(`unterminated JSON object after ${marker}`);
}

export function extractYtcfg(html) {
  const marker = "ytcfg.set(";
  const config = {};

  for (
    let index = html.indexOf(marker);
    index !== -1;
    index = html.indexOf(marker, index + marker.length)
  ) {
    if (html[index + marker.length] !== "{") {
      continue;
    }

    try {
      Object.assign(config, extractJsonObject(html, marker, index));
    } catch {
      // Some ytcfg.set calls use JavaScript literals instead of JSON.
    }
  }

  return config;
}

function* findKey(node, key) {
  if (!node || typeof node !== "object") {
    return;
  }

  for (const [name, value] of Object.entries(node)) {
    if (name === key) {
      yield value;
    } else {
      yield* findKey(value, key);
    }
  }
}

function textOf(value) {
  return value?.simpleText
    ?? value?.runs?.map((run) => run.text).join("")
    ?? "";
}

// "Move to top" is the row's only move action without a neighbor reference.
function findMoveToTopEndpoint(renderer) {
  const matches = [];

  for (const endpoint of findKey(renderer.menu, "playlistEditEndpoint")) {
    const [action, ...rest] = endpoint.actions ?? [];

    if (
      endpoint.playlistId === "WL"
      && rest.length === 0
      && action?.action === "ACTION_MOVE_VIDEO_AFTER"
      && action.setVideoId === renderer.setVideoId
      && !action.movedSetVideoIdPredecessor
    ) {
      matches.push(endpoint);
    }
  }

  return matches.length === 1 ? matches[0] : null;
}

export function parsePlaylistPage(node) {
  const items = [];

  for (const renderer of findKey(node, "playlistVideoRenderer")) {
    if (!renderer.videoId || !renderer.setVideoId) {
      continue;
    }

    const position = Number.parseInt(textOf(renderer.index), 10);
    items.push({
      id: renderer.videoId,
      title: textOf(renderer.title),
      originalPosition: Number.isInteger(position) ? position : null,
      setVideoId: renderer.setVideoId,
      moveToTop: findMoveToTopEndpoint(renderer),
    });
  }

  const command = findKey(node, "continuationCommand").next().value;
  return { items, continuation: command?.token ?? null };
}

// Fetch errors can quote header values, which hold the session cookies.
async function send(fetchImpl, url, init) {
  try {
    return await fetchImpl(url, init);
  } catch (error) {
    const code = error.cause?.code ? `: ${error.cause.code}` : "";
    throw new Error(`request to ${new URL(url).pathname} failed${code}`);
  }
}

export async function openWatchLater(cookies, { fetchImpl = fetch } = {}) {
  const pageResponse = await send(fetchImpl, WATCH_LATER_URL, {
    headers: {
      cookie: cookieHeader(cookies),
      "user-agent": USER_AGENT,
      "accept-language": "en-US,en;q=0.9",
    },
  });

  if (!pageResponse.ok) {
    throw new Error(`Watch Later page returned HTTP ${pageResponse.status}`);
  }

  const html = await pageResponse.text();
  const config = extractYtcfg(html);

  if (config.LOGGED_IN !== true) {
    throw new Error(
      "YouTube does not see a signed-in session; sign in to YouTube in Chrome",
    );
  }

  const list = findKey(
    extractJsonObject(html, "var ytInitialData = "),
    "playlistVideoListRenderer",
  ).next().value;

  if (!list) {
    throw new Error("Watch Later playlist data was not found on the page");
  }

  if (list.canReorder !== true) {
    throw new Error("YouTube reports that Watch Later cannot be reordered");
  }

  const post = async (endpoint, body) => {
    const headers = {
      authorization: authorizationHeader(cookies),
      "content-type": "application/json",
      cookie: cookieHeader(cookies),
      origin: YOUTUBE_ORIGIN,
      "user-agent": USER_AGENT,
      "x-goog-authuser": String(config.SESSION_INDEX ?? 0),
      "x-origin": YOUTUBE_ORIGIN,
      "x-youtube-client-name": String(config.INNERTUBE_CONTEXT_CLIENT_NAME),
      "x-youtube-client-version": config.INNERTUBE_CLIENT_VERSION,
    };

    if (config.DELEGATED_SESSION_ID) {
      headers["x-goog-pageid"] = config.DELEGATED_SESSION_ID;
    }

    const response = await send(
      fetchImpl,
      `${YOUTUBE_ORIGIN}/youtubei/v1/${endpoint}?prettyPrint=false`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ context: config.INNERTUBE_CONTEXT, ...body }),
      },
    );

    if (!response.ok) {
      throw new Error(`YouTube ${endpoint} returned HTTP ${response.status}`);
    }

    return response.json();
  };

  return {
    async loadPlaylist({ maxPages = 100 } = {}) {
      const items = new Map();
      let page = parsePlaylistPage(list);

      for (let pageCount = 1; ; pageCount += 1) {
        for (const item of page.items) {
          if (!items.has(item.id)) {
            items.set(item.id, item);
          }
        }

        if (!page.continuation) {
          return Array.from(items.values());
        }

        if (pageCount >= maxPages) {
          throw new Error(`playlist did not end after ${maxPages} pages`);
        }

        const response = await post("browse", {
          continuation: page.continuation,
        });
        page = parsePlaylistPage(response.onResponseReceivedActions);
      }
    },

    async moveToTop(item) {
      if (!item.moveToTop) {
        throw new Error(`Move to top action is unavailable for video ${item.id}`);
      }

      const { playlistId, actions, params } = item.moveToTop;
      const response = await post("browse/edit_playlist", {
        playlistId,
        actions,
        params,
      });

      if (response.status !== "STATUS_SUCCEEDED") {
        throw new Error(
          `YouTube rejected the move for video ${item.id}: `
            + `${response.status ?? "no status"}`,
        );
      }
    },
  };
}
