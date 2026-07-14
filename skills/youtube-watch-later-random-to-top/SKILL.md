---
name: youtube-watch-later-random-to-top
description: Select a requested number of distinct videos uniformly from a signed-in user's entire YouTube Watch Later playlist, including its current first item, process them in random order, and position the selected set at the top through the in-app Browser and each video's three-dot menu when needed. Use when the user asks to randomize, surface, rediscover, or move N random Watch Later videos to the top of that playlist.
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
5. Keep video rows with a canonical video ID and exclude unavailable placeholders. Include the current first video as an eligible candidate even if its menu omits `Move to top`.
6. If `N` exceeds the number of eligible candidates, make no changes and report the maximum valid value.

Scrolling is a read-only preflight. Do not choose the sample until loading and validation are complete.

## Select the videos

Shuffle the entire eligible candidate list once with Fisher-Yates or an equivalent unbiased algorithm driven by a runtime random-number source. Take the first `N` entries as the sample and preserve that shuffled order as the movement sequence. For example, a valid sequence of original playlist positions could be `340, 10, 1, 65, 100, 76`. Do not sort the sample by original position, title, or video ID, and do not reshuffle it before moving.

Retain each selected video's canonical video ID, visible title, and original one-based playlist position. Use the video ID for reacquisition because titles may repeat; use positions only for reporting the sampled movement sequence.

## Move each selected video

Process every sampled video in the preserved shuffled sequence:

1. Reacquire its current playlist row by canonical video ID. Do this fresh after every prior move because YouTube rerenders and reorders the list.
2. If its ID is already the first playlist item, treat it as satisfied and skip the redundant menu action. Its menu may legitimately omit `Move to top`.
3. Otherwise, scroll that row into view.
4. Open the three-dot menu within that row. Do not use a menu button from a different row.
5. Click the visible menu item named `Move to top`, or its clearly equivalent localized label. If the intended action is not unambiguous, do not click.
6. Wait briefly for the interaction to complete and the page to become usable for the next target.
7. Continue without checking the video's resulting position.

Do not verify playlist order during or after the run. Do not refresh, poll row positions, or cancel because the visible order remains unchanged. YouTube may persist a move before its playlist UI reflects the new order, and immediate verification can produce false failures.

If the user requests a particular final top-block order, derive the required movement sequence by reversing that requested order instead of using the default random movement sequence.

## Handle failures

Stop further mutations only when the interaction itself cannot safely continue, such as when a target row cannot be reacquired after a reasonable retry, the intended menu action is absent or ambiguous, a click fails, authentication is lost, or the browser navigates unexpectedly. Do not treat stale positions, unchanged ordering, or ordering that changes after a later refresh as failures.

When stopping, report:

- videos for which `Move to top` was submitted or no action was needed,
- the video that failed,
- why the interaction could not continue,
- how many selected videos remain untouched.

Do not attempt to roll back successful moves unless the user explicitly asks.

## Report completion

After every selection has been handled, report the number selected and list their original positions and titles in movement order. Distinguish submitted `Move to top` actions from videos that were already first and needed no action. State briefly that no final order verification was performed because YouTube updates the playlist asynchronously.
