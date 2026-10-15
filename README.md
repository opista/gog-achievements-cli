# GOG Achievements CLI

Restore GOG achievements you already earned, from macOS or Windows. Find your games, select missing achievements, and review a saved queue before you apply it.

The CLI shows readable text by default. Every command also supports JSON for scripts and LLM agents. Existing unlocks and their dates stay unchanged.

[Install](#install) · [Quick start](#quick-start) · [Features](#features) · [LLM agents](#use-with-an-llm-agent) · [Reference](https://github.com/opista/gog-achievements-cli/blob/main/docs/cli-reference.md) · [Contributing](https://github.com/opista/gog-achievements-cli/blob/main/CONTRIBUTING.md)

## Features

| Feature                                                                    | Commands                                            |
| -------------------------------------------------------------------------- | --------------------------------------------------- |
| Sign in through a native GOG window and store credentials securely.        | `auth login`, `auth status`, `auth logout`          |
| Search your owned games, or get IDs without titles.                        | `games list --search TEXT`, `games list --ids-only` |
| View achievements, including hidden entries, lock status and unlock dates. | `achievements list --game GAME_ID`                  |
| Save selected achievements in a local queue for one account and game.      | `queue create`, `queue add`, `queue remove`         |
| Set a date for each queued achievement.                                    | `queue set-date`                                    |
| Inspect a saved queue without network access.                              | `queue show`                                        |
| Preview changes, apply them, and check each result against GOG.            | `queue apply --dry-run`, `queue apply --yes`        |
| Check local support and saved login availability.                          | `doctor`                                            |
| Discover command options and get structured output.                        | `--help`, `--json`, `--json --pretty`               |

## Install

Download the ZIP for your computer from the **[latest release](https://github.com/opista/gog-achievements-cli/releases/latest)** and extract it.

| Computer                                    | ZIP name ends with  |
| ------------------------------------------- | ------------------- |
| Mac with Apple Silicon, macOS 13.5 or later | `macos-arm64.zip`   |
| Mac with Intel, macOS 13.5 or later         | `macos-x64.zip`     |
| Windows 10 or 11, Intel or AMD x64          | `windows-x64.zip`   |
| Windows 10 or 11, ARM64                     | `windows-arm64.zip` |

The packages include their runtime. You do not need to install Node, npm, .NET or a compiler. Keep the extracted folder intact, especially on Intel Macs, where the executable needs its adjacent runtime folders.

Run the executable from that folder:

```sh
# macOS
./gog-achievements --help
```

```powershell
# Windows PowerShell
.\gog-achievements.exe --help
```

**Command convention:** examples below use `gog-achievements` on PATH. Without PATH setup, use `./gog-achievements` on macOS or `.\gog-achievements.exe` on Windows.

Windows sign-in requires the [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/). The CLI gives an install instruction if it is missing. Mac executables use ad hoc signing; Windows executables are unsigned. Apple notarization and trusted code signing are not configured.

## Quick start

### 1. Sign in and find a game

```sh
gog-achievements doctor
gog-achievements auth login
gog-achievements games list --search Cyberpunk
```

Complete sign-in in the GOG window. The command saves your login in Mac Keychain or Windows encrypted credential storage, closes the window, and confirms the result.

Replace `GAME_ID` below with an ID from your game list. Then choose the IDs of locked achievements you already earned. Replace `ACHIEVEMENT_ID` with one of those IDs. These names are placeholders, not literal arguments.

```sh
gog-achievements achievements list --game GAME_ID
```

### 2. Create a queue and review it

```sh
gog-achievements queue create --game GAME_ID --file queue.json
gog-achievements queue add --file queue.json --achievement ACHIEVEMENT_ID
gog-achievements queue show --file queue.json
```

These commands save a local file. They make no achievement writes to GOG. Each added item gets a date ten seconds before it was added unless you supply `--unlocked-at`.

### 3. Preview, then apply

```sh
gog-achievements queue apply --file queue.json --dry-run
```

Check the account, game, selected achievements and dates. Without `--yes`, apply always previews. When you are ready to make those changes, close the game and run:

```sh
gog-achievements queue apply --file queue.json --yes
```

The CLI validates the whole queue before a write, checks each achievement again before writing, and reads back each result. It skips existing unlocks. A failure, an unconfirmed result or a different returned date stops further writes. The queue stays available for review. See [result statuses](#apply-results) before retrying.

## Manage your queue

Repeat `--achievement` to select multiple achievements. You can select them when you create the queue, or add them later. Replace `FIRST_ID` and `SECOND_ID` with your chosen achievement IDs:

```sh
gog-achievements queue create --game GAME_ID --file another-queue.json --achievement FIRST_ID --achievement SECOND_ID
```

To set a date, use an RFC 3339 timestamp with a time zone. Dates cannot be in the future. The CLI stores and displays dates in UTC at second precision.

```sh
gog-achievements queue set-date --file queue.json --achievement ACHIEVEMENT_ID --unlocked-at 2026-10-01T18:30:00+01:00
gog-achievements queue show --file queue.json
```

`queue create` and `queue add` also accept `--unlocked-at`. Each queued item has its own date. GOG may return a different date; server date limits have not been verified through a real achievement write.

Remove an item from the local queue with:

```sh
gog-achievements queue remove --file queue.json --achievement ACHIEVEMENT_ID
```

Queue files belong to one account and game. Create refuses to overwrite an existing file. Edits and apply use a lock file to prevent concurrent CLI changes. See the [queue format and lock guidance](https://github.com/opista/gog-achievements-cli/blob/main/docs/cli-reference.md#queue-files) if you edit files directly or need to recover a stale lock.

## Sign-in options

| Task                                            | Command                                     |
| ----------------------------------------------- | ------------------------------------------- |
| Check the saved login without revealing tokens. | `gog-achievements auth status`              |
| Allow five minutes for browser sign-in.         | `gog-achievements auth login --timeout 300` |
| Remove this tool's local login.                 | `gog-achievements auth logout`              |

Normal sign-in needs one command and a human in the native window. It waits up to three minutes by default; `--timeout` accepts 10 to 600 seconds. Close the window or press Ctrl+C to cancel. Progress goes to stderr.

For manual sign-in, run `auth login --no-open` locally, open the returned URL, and copy the final callback URL after sign-in. Then run `auth finish --clipboard`. `auth finish --stdin` accepts a callback URL or code from a pipe; `auth import --stdin` accepts an existing refresh token. Keep codes and tokens out of command arguments, chat, logs and plaintext files. See [authentication details and troubleshooting](https://github.com/opista/gog-achievements-cli/blob/main/docs/cli-reference.md#authentication).

Logout removes only this tool's saved login. It does not sign out GOG Galaxy or revoke other sessions.

## Use with an LLM agent

Give your agent this README, the game you want to restore, the achievements you already earned, and your date preferences. The agent must use `--json` on every command and follow this workflow:

1. Discover the installed command contract with `gog-achievements --help --json`. Use command-specific help, such as `gog-achievements queue add --help --json`, for required flags and options.
2. Run `doctor --json` and `auth status --json`. Inspect their data: exit 0 alone does not mean the computer is supported or the user is signed in. If sign-in is needed, run `auth login --json` and let the human complete the local window. Never ask them to paste credentials or callback URLs into chat. An expired access token can refresh on the next GOG command.
3. Use `games list --json`, optionally with `--search`, then `achievements list --game GAME_ID --json`. Keep all IDs as strings. Select only locked achievements the user says they earned.
4. Use `queue create` and `queue add` with `--json` to save that selection. Use the user's dates, or explain the default date before review. Show `queue show --file queue.json --json` and `queue apply --file queue.json --dry-run --json` for review.
5. Apply the exact reviewed selection and dates only within the user's explicit authorization. Add `--yes` only at this step. Inspect every result, including any different returned date. On exit 6, read `error.details.report`, check the live achievement state, and stop for review before a retry. Never blindly repeat an achievement write.

### JSON contract

`--json` returns one compact JSON object on stdout. Add `--pretty` for indentation. Capture stderr separately for progress. Parse stdout even when the process exits with a nonzero code; it contains the structured error.

Success envelope:

```json
{ "ok": true, "data": {} }
```

Error envelope:

```json
{ "ok": false, "error": { "code": "AUTH_REQUIRED", "message": "Sign in with auth login." } }
```

Game, client, user and achievement IDs are positive decimal **strings**, including values larger than JavaScript's safe integer range. Queue schema version is `1`. Use queue commands to create valid files; requested unlock dates must never be `null`.

Text remains the default in terminals and pipes. `--pretty` alone still produces text; it does not select JSON. Text errors go to stderr. `-h` and `help <command>` also show help.

### Apply results

| Item status                    | Meaning                                                         |
| ------------------------------ | --------------------------------------------------------------- |
| `pending`                      | Preview only; no write was made.                                |
| `restored`                     | Unlock and requested date confirmed.                            |
| `skipped_already_unlocked`     | Existing unlock preserved; no write was made.                   |
| `restored_with_different_date` | Unlock confirmed, but GOG returned another date.                |
| `failed`                       | Write rejected and unlock not confirmed.                        |
| `unconfirmed`                  | Write or readback could not be confirmed. Check the live state. |
| `not_attempted`                | Apply stopped before this item was written.                     |

A lost write response is checked by reads; the CLI never repeats that POST automatically. A retry skips existing unlocks and does not change their dates.

### Exit codes

| Code | Meaning                                                                  |
| ---- | ------------------------------------------------------------------------ |
| 0    | Command completed. Inspect its data; manual login can still need action. |
| 2    | Invalid input or queue file.                                             |
| 3    | Login required or rejected.                                              |
| 4    | Network or API response failure.                                         |
| 5    | Account, ownership, game or queue lock conflict.                         |
| 6    | Apply incomplete. Read `error.details.report`.                           |
| 7    | Native credential store, browser runtime or local process failure.       |

## Scope and limits

- Restore platform achievement records you already earned. The CLI does not edit game statistics, repair in-game triggers, reset achievements, or change dates on existing unlocks.
- Keep the game closed during apply. GOG has no atomic compare-and-set operation, so another client can change an achievement between requests.
- CI tests all four release targets with fixtures, native self-tests and packaged smoke checks. Live browser sign-in and real achievement writes need manual checks. Date handling has fixture coverage; historical date acceptance remains unverified on a real account.
- GOG web endpoints and GOGDB metadata are unofficial and can change. See the [protocol references](https://github.com/opista/gog-achievements-cli/blob/main/docs/cli-reference.md#protocol-references).

## Build and contribute

For source use, install Node 22 or later. For development and release builds, use the Node 24 version in `.node-version`. Mac builds need Xcode Command Line Tools; Windows builds need the .NET 10 SDK selected by `global.json`.

```sh
npm ci --ignore-scripts
npm run compile
node bin/gog-achievements.mjs --help
```

Run `npm run build` to build the native helper and standalone package for your current OS and Node architecture. Source sign-in and credential operations need the helper. For checks, architecture boundaries, build targets and releases, see the **[contributor guide](https://github.com/opista/gog-achievements-cli/blob/main/CONTRIBUTING.md)**. `npm run demo` shows an offline fixture workflow without GOG requests or access to your login.

The project uses the [MIT license](LICENSE). Bundled runtime licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
