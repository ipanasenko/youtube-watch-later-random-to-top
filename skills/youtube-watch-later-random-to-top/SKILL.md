---
name: youtube-watch-later-random-to-top
description: Select a requested number of distinct videos uniformly from a signed-in user's entire YouTube Watch Later playlist, including its current first item, process them in random order, and position the selected set at the top through the in-app Browser and each video's three-dot menu when needed. Use when the user asks to randomize, surface, rediscover, or move N random Watch Later videos to the top of that playlist.
---

# Move Random Watch Later Videos to the Top

Use the Browser plugin's `control-in-app-browser` skill, the in-app Browser, and the bundled `scripts/watch-later.mjs` automation module. Treat invocation of this skill as explicit in-app Browser intent.

Perform every playlist mutation through YouTube's visible playlist UI. Do not use private APIs, direct HTTP requests, cookies, storage, or a different browser.

## Run the automation

1. Extract `N` from the request. If it is missing, ask for it before opening or changing the playlist. Require a positive integer.
2. Initialize the in-app Browser exactly as required by `control-in-app-browser` and read its complete documentation.
3. Create a fresh in-app Browser tab. The script always navigates it to `https://www.youtube.com/playlist?list=WL`.
4. Import and run the bundled module from the selected skill directory:

```js
globalThis.watchLaterModule = await import(
  "<selected-skill-directory>/scripts/watch-later.mjs"
);
globalThis.watchLaterOutcome = await watchLaterModule.runRandomWatchLaterToTop(
  tab,
  N
);
nodeRepl.write(JSON.stringify(watchLaterOutcome));
```

Use the absolute selected skill directory in the import. Do not run the module from a normal shell process: the in-app Browser connection is available only in the trusted Browser Node session.

The module performs the complete workflow:

- Loads and deduplicates the entire lazy-loaded playlist, requiring three stable bottom passes.
- Excludes unavailable placeholders and includes the current first item.
- Rejects `N` larger than the eligible pool before making changes.
- Samples once with Fisher-Yates and preserves the sampled movement order.
- Reacquires each row by canonical video ID, uses that row's three-dot menu, and clicks the unique visible `Move to top` action.
- Retries transient YouTube rerenders within bounded limits and stops at the first unsafe interaction failure.
- Never refreshes, polls, or verifies final playlist order.

If the user requests a particular final top-block order instead of a random set, use the module's exported `createYouTubeBrowserPort`, `loadCompletePlaylist`, and `moveSelectedVideos` functions. Resolve the requested videos by canonical ID, reverse the requested final order to obtain the movement sequence, and preserve that sequence exactly.

If authentication is required before any mutation, ask the user to sign in in the in-app Browser and tell you when it is ready. Do not switch browsers or bypass sign-in.

## Handle failures

When the returned outcome contains `failure`, report:

- Entries in `results` as submitted or already first.
- The failed target and `reason`.
- The number of entries in `untouched`.

Do not attempt to roll back successful moves unless the user explicitly asks.

## Report completion

Report the number selected and list `selected` entries by original position and title in movement order. Distinguish submitted actions from videos already first. State briefly that no final order verification was performed because YouTube updates the playlist asynchronously.
