---
name: youtube-watch-later-random-to-top
description: Move a requested number of distinct, randomly selected videos from a signed-in user's YouTube Watch Later playlist to the top through the in-app Browser and each video's three-dot menu. Use when the user asks to randomize, surface, rediscover, or move N random Watch Later videos to the top of that playlist.
---

# Move Random Watch Later Videos to the Top

Use the Browser plugin's `control-in-app-browser` skill and the in-app Browser. Treat invocation of this skill as explicit in-app Browser intent. Perform the work through YouTube's visible playlist UI; do not use private APIs, direct HTTP requests, cookies, storage, or a different browser.

## Validate the request

1. Extract `N` from the request. If it is missing, ask for it before opening or changing the playlist.
2. Require `N` to be a positive integer.
3. Open `https://www.youtube.com/playlist?list=WL` in the in-app Browser, even if another page or playlist is already open.
4. If YouTube requires authentication, ask the user to sign in in the in-app Browser and tell you when it is ready. Do not switch browsers or bypass sign-in.

## Load the complete playlist

1. Wait for the playlist items to render.
2. Repeatedly scroll to the last rendered playlist item, allowing lazy-loaded items to appear after each scroll.
3. Track rendered candidates by canonical YouTube video ID, not by title or playlist index. Deduplicate IDs.
4. Consider the playlist fully loaded only when the page is at the bottom and three consecutive scroll-and-wait passes add no new video IDs.
5. Keep only actionable video rows. Exclude unavailable placeholders and the current first video, because moving it to the top would be a no-op and its menu may omit the action.
6. If `N` exceeds the number of actionable candidates, make no changes and report the maximum valid value.

Scrolling is a read-only preflight. Do not choose the sample until loading and validation are complete.

## Select the videos

Choose `N` distinct candidates uniformly without replacement. Use a Fisher-Yates shuffle or equivalent unbiased sampling, driven by a runtime random-number source. Retain each selected video's canonical video ID and visible title for reacquisition and the final report. Do not use a title as the identity because titles may repeat.

## Move each selected video

For every sampled video:

1. Reacquire its current playlist row by canonical video ID. Do this fresh after every prior move because YouTube rerenders and reorders the list.
2. Scroll that row into view.
3. Open the three-dot menu within that row. Do not use a menu button from a different row.
4. Click the visible menu item named `Move to top`, or its clearly equivalent localized label. If the intended action is not unambiguous, do not click.
5. Wait for the menu to close and the playlist to settle.
6. Verify that the selected video's ID is now the first playlist item before continuing.

Moving later selections to the top can reverse their sampled order. This is acceptable unless the user requests a particular final ordering.

## Handle failures

Do not blindly retry clicks after an ambiguous menu, stale row, unexpected navigation, or failed verification. Stop further mutations and report:

- videos successfully moved,
- the video that failed,
- why verification failed,
- how many selected videos remain untouched.

Do not attempt to roll back successful moves unless the user explicitly asks.

## Report completion

After all moves verify successfully, report the number moved and list their titles. Keep the response concise. Do not claim success based only on clicking; require the first-item verification after every move.
