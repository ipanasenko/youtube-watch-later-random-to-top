# YouTube Watch Later: Random to Top

`wl-random` moves random videos from your YouTube Watch Later playlist to the top. Use it to rediscover videos you saved long ago.

It runs in your terminal. It does not open a browser.

<img width="729" height="603" alt="YouTube's Move to top menu item in the Watch Later playlist" src="https://github.com/user-attachments/assets/2afe7a8c-dfcd-43b2-a940-fe70b6d3aacf" />

For each video, `wl-random` sends the same request as YouTube's **Move to top** menu item.

## Requirements

- macOS
- Google Chrome, signed in to YouTube
- Node.js 24 or later

## Install

Run it without installing:

```bash
npx @ipanasenko/wl-random 10
```

Or install the `wl-random` command:

```bash
npm install -g @ipanasenko/wl-random
```

## Usage

```bash
wl-random 10              # Move 10 random videos to the top
wl-random 10 --dry-run    # Show which 10 videos it picks, but move nothing
```

Example output:

```text
Selected 3 of 481 videos. Movement order:
  1. #340 How Rockets Work (moved)
  2. #10 The History of Maps (moved)
  3. #65 Why Bridges Stand Up (moved)
```

The number after `#` is the position of the video before the move.

### Options

| Option | Description |
|---|---|
| `--dry-run` | Load the playlist and pick the videos, but move nothing. |
| `--json` | Print the result as JSON. |
| `--profile <name>` | The Chrome profile folder to read. The default is `Default`. |
| `-h`, `--help` | Show help. |

### Chrome profiles

If you have more than one Chrome profile, use `--profile` to select the profile that is signed in to YouTube:

```bash
wl-random 5 --profile "Profile 1"
```

To find the folder name, open `chrome://version` in that profile. The last part of **Profile Path** is the folder name. If the name is wrong, `wl-random` lists the profiles that it found.

### Keychain prompt

Chrome encrypts its cookies with a key that it keeps in the macOS Keychain. Each time `wl-random` runs, macOS asks:

> security wants to use your confidential information stored in "Chrome Safe Storage" in your keychain.

Enter your password and click **Allow**.

> [!WARNING]
> Do not click **Always Allow**. If you do, macOS stops asking, and any program on your Mac that uses the `security` command can read this key without a prompt. This key decrypts all your Chrome cookies.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Success. |
| `1` | An error occurred before any video moved. |
| `2` | The command is not correct. |
| `3` | A move failed. The moves before it were applied. |

## How It Works

1. Reads your YouTube cookies from Chrome's cookie database and decrypts them with Chrome's key from the Keychain.
2. Loads the complete Watch Later playlist from YouTube, 100 videos at a time. YouTube hides unavailable videos, so `wl-random` does not pick them.
3. Picks `N` different videos at random from the whole playlist, including the current first video.
4. Moves the videos to the top one at a time, in the order that it picked them.
5. Prints the picked videos and their original positions, in movement order.

Each move puts a video at position 1. So the final top block is the reverse of the movement order. For example, if the movement order is:

```text
340 → 10 → 1 → 65 → 100 → 76
```

The new top of the playlist is:

```text
76, 100, 65, 1, 10, 340
```

If a move fails, `wl-random` stops. It shows the moves that worked, the video that failed, and how many videos it did not try. It does not undo the moves that worked.

## Privacy and Risks

⚠️ `wl-random` uses your signed-in YouTube session. Read this before you use it.

- **Cookies:** Chrome locks its cookie database, so `wl-random` copies the database to a private temporary folder. It decrypts only the `youtube.com` cookies, and then deletes the copy. It sends the cookies only to `www.youtube.com`. It does not save or log them.
- **Account access:** these cookies give access to your Google account, not only to YouTube.
- **Internal API:** the official YouTube Data API cannot read or reorder Watch Later. So `wl-random` uses YouTube's internal web API, which is the API that youtube.com itself uses. This API is not documented and can change at any time. If YouTube changes it, `wl-random` stops with an error. It does not guess.
- **Terms of Service:** YouTube's Terms of Service restrict automated access. Use this tool at your own risk.

## Development

```bash
npm test
```

### Releasing

GitHub Actions publishes to npm through [trusted publishing](https://docs.npmjs.com/trusted-publishers), so no npm token is stored anywhere. Each release gets a provenance statement that links the package to the commit that built it.

1. Change `version` in `package.json` and merge the change to `main`.
2. Push a tag with the same version:

   ```bash
   git tag v0.3.0
   git push origin v0.3.0
   ```

The workflow stops if the tag does not match `package.json`.

## Earlier Versions

The first version of this project was an agent skill. It clicked through YouTube's interface in Codex's in-app Browser. This CLI replaces it.
