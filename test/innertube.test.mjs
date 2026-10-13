import test from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, createHash } from "node:crypto";

import {
  decryptCookieValue,
  deriveCookieKey,
} from "../src/chrome-cookies.mjs";
import {
  authorizationHeader,
  extractYtcfg,
  openWatchLater,
  parsePlaylistPage,
  sapisidHash,
} from "../src/innertube.mjs";

function encryptCookie(value, key, hostKey, { withDigest = true } = {}) {
  const cipher = createCipheriv("aes-128-cbc", key, Buffer.alloc(16, " "));
  const digest = withDigest
    ? createHash("sha256").update(hostKey).digest()
    : Buffer.alloc(0);
  return Buffer.concat([
    Buffer.from("v10"),
    cipher.update(Buffer.concat([digest, Buffer.from(value)])),
    cipher.final(),
  ]);
}

function row(videoId, setVideoId, index) {
  const edit = (action) => ({
    menuServiceItemRenderer: {
      serviceEndpoint: {
        playlistEditEndpoint: {
          playlistId: "WL",
          actions: [{ setVideoId, action }],
          params: "CAFAAQ%3D%3D",
        },
      },
    },
  });

  return {
    playlistVideoRenderer: {
      videoId,
      setVideoId,
      title: { runs: [{ text: `Video ${videoId}` }] },
      index: { simpleText: String(index) },
      menu: {
        menuRenderer: {
          items: [
            edit("ACTION_REMOVE_VIDEO"),
            edit("ACTION_MOVE_VIDEO_AFTER"),
            edit("ACTION_MOVE_VIDEO_BEFORE"),
          ],
        },
      },
    },
  };
}

function continuation(token) {
  return {
    continuationItemRenderer: {
      continuationEndpoint: {
        commandExecutorCommand: {
          commands: [{ continuationCommand: { token } }],
        },
      },
    },
  };
}

test("decryptCookieValue removes the host digest for schema 24 and later", () => {
  const key = deriveCookieKey("password");
  const encrypted = encryptCookie("secret-value", key, ".youtube.com");

  assert.equal(
    decryptCookieValue(encrypted, key, ".youtube.com", 24),
    "secret-value",
  );
  assert.throws(
    () => decryptCookieValue(encrypted, key, ".example.com", 24),
    /host digest mismatch/,
  );
});

test("decryptCookieValue keeps the whole value before schema 24", () => {
  const key = deriveCookieKey("password");
  const encrypted = encryptCookie("legacy", key, ".youtube.com", {
    withDigest: false,
  });

  assert.equal(decryptCookieValue(encrypted, key, ".youtube.com", 23), "legacy");
  assert.throws(
    () => decryptCookieValue(Buffer.from("v11abc"), key, ".youtube.com", 24),
    /unsupported Chrome cookie encryption "v11"/,
  );
});

test("authorizationHeader signs every available SAPISID variant", () => {
  const now = 1_700_000_000_000;
  const hash = "1700000000_27b236f59d4ec583d7530f2c7055d2f9c6aecf92";
  const cookies = new Map([
    ["SAPISID", "abc"],
    ["__Secure-1PAPISID", "abc"],
    ["__Secure-3PAPISID", "abc"],
  ]);

  assert.equal(sapisidHash("abc", "https://www.youtube.com", now), hash);
  assert.equal(
    authorizationHeader(cookies, "https://www.youtube.com", now),
    `SAPISIDHASH ${hash} SAPISID1PHASH ${hash} SAPISID3PHASH ${hash}`,
  );
  assert.throws(() => authorizationHeader(new Map()), /sign in to YouTube/);
});

test("extractYtcfg merges JSON config calls and skips JavaScript literals", () => {
  const html = [
    "<script>ytcfg.set({\"CSI\": 'youtube'});</script>",
    "<script>ytcfg.set({\"LOGGED_IN\": true, \"NOTE\": \"has } brace\"});</script>",
    "<script>ytcfg.set(\"KEY\", 1);</script>",
    "<script>ytcfg.set({\"SESSION_INDEX\": \"0\"});</script>",
  ].join("");

  assert.deepEqual(extractYtcfg(html), {
    LOGGED_IN: true,
    NOTE: "has } brace",
    SESSION_INDEX: "0",
  });
});

test("parsePlaylistPage picks the Move to top action and the continuation", () => {
  const page = parsePlaylistPage({
    contents: [row("a", "SA", 1), row("b", "SB", 2), continuation("next")],
  });

  assert.equal(page.continuation, "next");
  assert.deepEqual(page.items.map((item) => item.id), ["a", "b"]);
  assert.deepEqual(page.items[1], {
    id: "b",
    title: "Video b",
    originalPosition: 2,
    setVideoId: "SB",
    moveToTop: {
      playlistId: "WL",
      actions: [{ setVideoId: "SB", action: "ACTION_MOVE_VIDEO_AFTER" }],
      params: "CAFAAQ%3D%3D",
    },
  });
});

function fakeYouTube({ loggedIn = true, editStatus = "STATUS_SUCCEEDED" } = {}) {
  const requests = [];
  const config = {
    LOGGED_IN: loggedIn,
    SESSION_INDEX: "0",
    INNERTUBE_CONTEXT: { client: { clientName: "WEB" } },
    INNERTUBE_CONTEXT_CLIENT_NAME: 1,
    INNERTUBE_CLIENT_VERSION: "2.0",
  };
  const initialData = {
    contents: {
      playlistVideoListRenderer: {
        canReorder: true,
        contents: [row("a", "SA", 1), continuation("page-2")],
      },
    },
  };
  const html = `<script>ytcfg.set(${JSON.stringify(config)});</script>`
    + `<script>var ytInitialData = ${JSON.stringify(initialData)};</script>`;

  const fetchImpl = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({ url, headers: init.headers, body });

    if (!init.method) {
      return new Response(html);
    }

    if (url.includes("/browse/edit_playlist")) {
      return Response.json({ status: editStatus });
    }

    return Response.json({
      onResponseReceivedActions: [{
        appendContinuationItemsAction: {
          continuationItems: [row("b", "SB", 2)],
        },
      }],
    });
  };

  return { fetchImpl, requests };
}

const sessionCookies = new Map([["SAPISID", "abc"], ["SID", "sid"]]);

test("openWatchLater pages through the playlist and replays Move to top", async () => {
  const { fetchImpl, requests } = fakeYouTube();
  const client = await openWatchLater(sessionCookies, { fetchImpl });
  const items = await client.loadPlaylist();

  assert.deepEqual(items.map((item) => item.id), ["a", "b"]);
  assert.equal(requests[1].body.continuation, "page-2");
  assert.deepEqual(requests[1].body.context, { client: { clientName: "WEB" } });

  await client.moveToTop(items[1]);
  const edit = requests.at(-1);

  assert.match(edit.url, /\/youtubei\/v1\/browse\/edit_playlist\?/);
  assert.match(edit.headers.authorization, /^SAPISIDHASH \d+_[0-9a-f]{40}$/);
  assert.equal(edit.headers.cookie, "SAPISID=abc; SID=sid");
  assert.deepEqual(edit.body, {
    context: { client: { clientName: "WEB" } },
    playlistId: "WL",
    actions: [{ setVideoId: "SB", action: "ACTION_MOVE_VIDEO_AFTER" }],
    params: "CAFAAQ%3D%3D",
  });
});

test("openWatchLater rejects signed-out sessions and failed moves", async () => {
  await assert.rejects(
    openWatchLater(sessionCookies, fakeYouTube({ loggedIn: false })),
    /does not see a signed-in session/,
  );

  const { fetchImpl } = fakeYouTube({ editStatus: "STATUS_FAILED" });
  const client = await openWatchLater(sessionCookies, { fetchImpl });
  const [item] = await client.loadPlaylist();

  await assert.rejects(
    client.moveToTop(item),
    /YouTube rejected the move for video a: STATUS_FAILED/,
  );
});
