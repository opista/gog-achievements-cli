# GOG Achievements CLI

Restore earned GOG achievements or re-lock selected achievements, from macOS or Windows. Find your games and review a saved queue before you apply it. A queue can contain both unlocks and locks.

The CLI shows readable text by default. Every command also supports JSON for scripts and LLM agents. Existing unlocks and their dates stay unchanged unless you explicitly queue a lock.

[Install](#install) · [Quick start](#quick-start) · [Features](#features) · [LLM agents](#use-with-an-llm-agent) · [Reference](https://github.com/opista/gog-achievements-cli/blob/main/docs/cli-reference.md) · [Contributing](https://github.com/opista/gog-achievements-cli/blob/main/CONTRIBUTING.md)

## Features

| Feature                                                                     | Commands                                                  |
| --------------------------------------------------------------------------- | --------------------------------------------------------- |
| Sign in through a native GOG window and store credentials securely.         | `auth login`, `auth status`, `auth logout`                |
| Search your owned games, or get IDs without titles.                         | `games list --search TEXT`, `games list --ids-only`       |
| View achievements, including hidden entries, lock status and unlock dates.  | `achievements list --game GAME_ID`                        |
| Export achievements to a new UTF-8 CSV file with search and status filters. | `achievements export --game GAME_ID --file PATH`          |
| Save selected achievements in a local queue for one account and game.       | `queue create`, `queue add`, `queue remove`               |
| Queue unlocks, locks, or both, with each lock's original date saved.        | `queue create --action unlock`, `queue add --action lock` |
| Set a date for each queued achievement.                                     | `queue set-date`                                          |
| Inspect a saved queue without network access.                               | `queue show`                                              |
| Preview changes, apply them, and check each result against GOG.             | `queue apply --dry-run`, `queue apply --yes`              |
| Check local support and saved login availability.                           | `doctor`                                                  |
| Check for a new CLI release and install it manually.                        | `self update --check`, `self update`                      |
| Discover command options and get structured output.                         | `--help`, `--json`, `--json --pretty`                     |

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

## Update the CLI

For a standalone release package, run:

```sh
gog-achievements self update --check
gog-achievements self update
```

The first command checks the latest stable release. The second asks for confirmation, downloads the package for your computer, verifies its SHA-256 checksum, and tests the new executable before and after replacement. It updates the tool files, including the Intel Mac runtime, and keeps the previous files in a backup folder. Queue files and saved login stay unchanged.

Scripts and agents must explicitly confirm installation:

```sh
gog-achievements self update --yes --json
```

Successful `auth login` in text mode also makes a short update check and can print a notice to stderr. A failed or slow check does not change the login result. JSON login calls do not check for updates. There are no daily checks, background checks or automatic installations.

Source and package manager installations use their original update method. The desktop app manages its bundled CLI. These installations can use `self update --check`, but cannot replace themselves. See [update recovery](https://github.com/opista/gog-achievements-cli/blob/main/docs/cli-reference.md#cli-updates-and-recovery) if an update is interrupted.

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

Add `--search TEXT` to match achievement names or descriptions without case sensitivity. Combine it with `--status all|locked|unlocked` to limit the results. For example:

```sh
gog-achievements achievements list --game GAME_ID --search city --status locked --json
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

The CLI validates the whole queue before a write, checks each achievement again before writing, and reads back each result. Unlock requests skip existing unlocks. Lock requests skip achievements that are already locked. A failure, an unconfirmed result or a different returned date stops further writes. The queue stays available for review. See [result statuses](#apply-results) before retrying.

## Re-lock achievements or mix actions

Use `--action lock` on `queue create` or `queue add` to select unlocked achievements for locking. Without `--action`, the action is `unlock`. Each `--achievement` in a command uses that command's action.

To queue two locks, replace `FIRST_ID` and `SECOND_ID` with the IDs of the unlocked achievements you selected:

```sh
gog-achievements queue create --game GAME_ID --file locks.json --action lock --achievement FIRST_ID --achievement SECOND_ID
gog-achievements queue show --file locks.json
gog-achievements queue apply --file locks.json --dry-run
gog-achievements queue apply --file locks.json --yes
```

For a mixed queue, first queue two unlocks, then add two locks:

```sh
gog-achievements queue create --game GAME_ID --file mixed.json --action unlock --achievement UNLOCK_ID_1 --achievement UNLOCK_ID_2
gog-achievements queue add --file mixed.json --action lock --achievement LOCK_ID_1 --achievement LOCK_ID_2
gog-achievements queue show --file mixed.json
gog-achievements queue apply --file mixed.json --dry-run
gog-achievements queue apply --file mixed.json --yes
```

Review each action before using `--yes`. Lock requests save the current unlock date in the queue and each result. They accept no `--unlocked-at` value, and `queue set-date` rejects any selection that includes a lock. A changed unlock date stops apply; remove that lock request and add it again to review the new state. Removing an item from the queue only cancels the local request.

Apply follows queue order. Each write is separate: earlier confirmed changes stay applied if a later change fails. Apply never rolls them back automatically. Retry skips items already in their requested state. Keep the saved queue or capture the JSON report to retain previous dates. Restoring an exact historical date remains subject to GOG's date handling.

Re-locking clears the GOG achievement record. It does not reset game saves or statistics. The game or pending Galaxy synchronization may unlock it again. Live re-lock behavior and Galaxy display refresh remain unverified on a real account; tests use fixtures.

## Export achievements as CSV

```sh
gog-achievements achievements export --game GAME_ID --file achievements.csv
gog-achievements achievements export --game GAME_ID --file locked.csv --search story --status locked --json
```

Export uses the same search and status filters as `achievements list`. The CLI writes a new UTF-8 CSV file and refuses to overwrite an existing file. It includes hidden achievement details, keeps exact ID digits, and uses UTC unlock dates. Locked entries have an empty date. Import ID columns as text in spreadsheet applications to keep all digits. Default stdout confirms the path and row count; `--json` returns `{ "ok": true, "data": { "path": "/absolute/path/locked.csv", "count": 2 } }`. A selection with no matches writes the header with count 0. Export makes no achievement changes.

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

Give your agent this README, the game, the achievements you want to unlock or lock, and your date preferences for unlocks. The agent must use `--json` on every command and follow this workflow:

1. Discover the installed command contract with `gog-achievements --help --json`. Use command-specific help, such as `gog-achievements queue add --help --json`, for required flags and options.
2. Run `doctor --json` and `auth status --json`. Inspect their data: exit 0 alone does not mean the computer is supported or the user is signed in. If sign-in is needed, run `auth login --json` and let the human complete the local window. Never ask them to paste credentials or callback URLs into chat. An expired access token can refresh on the next GOG command.
3. Use `games list --json`, optionally with `--search`, then `achievements list --game GAME_ID --json`. Keep all IDs as strings. Queue unlocks only for locked achievements the user says they earned. Queue locks only for unlocked achievements the user explicitly selects.
4. Use `queue create` and `queue add` with `--json` to save that selection. Supply `--action lock` for locks; the default action is `unlock`. Use the user's unlock dates, or explain the default date before review. Lock requests save the original date and accept no new date. Show `queue show --file queue.json --json` and `queue apply --file queue.json --dry-run --json` for review, with every action identified.
5. Apply the exact reviewed actions, selection and dates only within the user's explicit authorization. Add `--yes` only at this step. Inspect every result, including any different returned date. On exit 6, read `error.details.report`, check the live achievement state, and stop for review before a retry. Never blindly repeat an achievement write.

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

Game, client, user and achievement IDs are positive decimal **strings**, including values larger than JavaScript's safe integer range. Queue schema version is `1`. Use queue commands to create valid files. An item without `action` is an unlock, preserving existing queues and default command results. An explicit unlock uses `action: "unlock"` and a non-null `unlocked_at`. A lock uses `action: "lock"` and `previous_unlocked_at`, with no `unlocked_at` field. Older CLI releases reject lock entries rather than apply them as unlocks.

Unlock reports keep their existing fields and statuses. Explicit actions are included as `action`. Lock results use `action: "lock"`, `requested_unlocked_at: null`, and the saved `previous_unlocked_at`. A lock is confirmed only by `locked` or `skipped_already_locked`; `actual_unlocked_at: null` alone does not confirm it.

Text remains the default in terminals and pipes. `--pretty` alone still produces text; it does not select JSON. Text errors go to stderr. `-h` and `help <command>` also show help.

### Apply results

| Item status                    | Meaning                                                         |
| ------------------------------ | --------------------------------------------------------------- |
| `pending`                      | Preview only; no write was made.                                |
| `restored`                     | Unlock and requested date confirmed.                            |
| `skipped_already_unlocked`     | Existing unlock preserved; no write was made.                   |
| `restored_with_different_date` | Unlock confirmed, but GOG returned another date.                |
| `locked`                       | Lock confirmed by a fresh read; previous date retained.         |
| `skipped_already_locked`       | Already locked; no write was made.                              |
| `failed`                       | Write rejected; requested state not confirmed.                  |
| `unconfirmed`                  | Write or readback could not be confirmed. Check the live state. |
| `not_attempted`                | Apply stopped before this item was written.                     |

A lost write response is checked by reads; the CLI never repeats that POST automatically. A retry skips achievements already in their requested state. A changed unlock date blocks a pending lock.

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

- Restore platform achievement records you already earned or re-lock explicitly selected achievements. The CLI does not edit game statistics, repair in-game triggers, or change dates on existing unlocks.
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
