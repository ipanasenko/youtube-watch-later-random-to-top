# YouTube Watch Later Random to Top Skill [![skills.sh](https://skills.sh/b/ipanasenko/youtube-watch-later-random-to-top)](https://skills.sh/ipanasenko/youtube-watch-later-random-to-top)

Move a random selection of videos from your YouTube Watch Later playlist to the top.

The skill uses YouTube's visible playlist controls in Codex's in-app Browser. It loads the complete playlist, samples `N` distinct videos, and moves them through each video's three-dot menu.

<img width="729" height="603" alt="image" src="https://github.com/user-attachments/assets/2afe7a8c-dfcd-43b2-a940-fe70b6d3aacf" />


## Install

```bash
npx -y skills@latest add ipanasenko/youtube-watch-later-random-to-top -g -a universal -y
```

## Example Usage

Ask your agent:

```text
Use the $youtube-watch-later-random-to-top skill to move 10 random videos to the top of my Watch Later playlist.
```

Or even shorter:

```text
$youtube-watch-later-random-to-top 10 videos.
```

## How It Works

1. Opens your YouTube Watch Later playlist in the in-app Browser.
2. Scrolls to the bottom so the complete lazy-loaded playlist is available.
3. Uniformly samples `N` distinct videos from the whole eligible playlist, including the current first video.
4. Processes the sample in random order and uses each video's `Move to top` menu action when needed.
5. Reports the sampled positions and titles in movement order.

For example, the movement sequence might be:

```text
340 → 10 → 1 → 65 → 100 → 76
```

Because every action moves a video to position 1, the final top block appears in reverse movement order:

```text
76, 100, 65, 1, 10, 340
```

## Login

You must be signed in to YouTube in Codex's in-app Browser. If authentication is required, the skill will pause and ask you to sign in there before continuing.

## Asynchronous Updates

YouTube may persist playlist changes before the visible ordering updates. The skill intentionally does not refresh, poll positions, or verify the final order because those checks can produce false failures. The applied order may become visible after a later page refresh.

## Privacy

The skill operates through YouTube's visible interface. It does not inspect browser cookies or storage, call private YouTube APIs, or switch to another browser.
