# GOG Achievements CLI

A standalone CLI for macOS and Windows for restoring GOG achievements you already earned. It shows readable text by default and supports JSON for AI tools and scripts.

## Use a standalone executable

Release packages contain `gog-achievements` on macOS or `gog-achievements.exe` on Windows. Node, npm, .NET and compiler installations are not needed to run them. Extract the archive and run the executable, or add its folder to PATH.

```sh
# macOS
./gog-achievements --help
```

```powershell
# Windows
.\gog-achievements.exe --help
```

Examples below use `gog-achievements` on PATH. Without PATH setup, use `./gog-achievements` on macOS or `.\gog-achievements.exe` on Windows.

Windows sign-in needs the [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/). It is included in Windows 11 and most Windows 10 installations. The CLI gives an install instruction if it is missing.

The release workflow targets macOS 13.5 or later on Apple Silicon and Intel, and Windows 10/11 on x64 and ARM64. These match the [Node 24 runtime platforms](https://github.com/nodejs/node/blob/v24.19.0/BUILDING.md#supported-platforms). CI runs tests on each target OS and architecture. Live GOG sign-in still needs a human on the target OS.

## Build from source

Source use requires Node 22 or later. Use Node 24 LTS for release builds; CI pins 24.19.0. Mac builds require Xcode Command Line Tools. Windows builds require the .NET 10 SDK selected by `global.json`.

```sh
npm ci --ignore-scripts
npm run check
npm test
npm run build
```

`build` builds the native helper, bundles the CLI with the current Node runtime, runs smoke checks outside the checkout, and creates a ZIP plus SHA-256 checksum in `dist/`. It builds for the current OS and Node architecture. Apple Silicon and Windows builds embed the runtime and helper in one executable. Intel Mac builds use a native launcher with a private runtime and helper folder; keep that extracted folder intact. This handles the Node single-executable limitation on Intel Macs. There is no `build:mac` command.

Run the source CLI with `node bin/gog-achievements.mjs`, or install its command with `npm install --global . --ignore-scripts` after building the helper. Source installation requires Node; release executables do not.

For example, an Apple Silicon build creates:

```text
dist/gog-achievements-VERSION-macos-arm64/gog-achievements
dist/gog-achievements-VERSION-macos-arm64.zip
dist/gog-achievements-VERSION-macos-arm64.zip.sha256
```

Release Please collects Conventional Commits into a release PR. Merging that PR creates a draft release and tag. The release workflow checks out the tag, runs code checks and tests, builds all four targets, verifies archive checksums, attaches the executables, then publishes the release. A failed check leaves a draft release that can be retried. See [CONTRIBUTING.md](CONTRIBUTING.md) for the code map, test gates and release setup.

Mac executables use ad hoc signing; Windows executables are unsigned. Developer ID signing, Apple notarization and Windows code signing are not configured. See `THIRD_PARTY_NOTICES.md` for bundled runtime licenses.

## Help and output

```sh
gog-achievements --help
gog-achievements achievements list --help
gog-achievements queue --help
```

Help lists commands in groups. Command help shows its options, required flags and examples. `-h` and `help <command>` also work.

| Flags             | Output                                            |
| ----------------- | ------------------------------------------------- |
| No output flags   | Readable summaries and tables.                    |
| `--pretty`        | Readable text, the same as the default.           |
| `--json`          | One compact JSON object for AI tools and scripts. |
| `--json --pretty` | The same JSON with indentation.                   |

```sh
gog-achievements games list
gog-achievements games list --json
gog-achievements games list --json --pretty
```

Text is the default in terminals and pipes. AI tools and scripts must pass `--json`; output does not switch format based on terminal detection. Existing scripts that used the earlier JSON default need this flag. Text errors go to stderr. JSON errors stay on stdout so a script can parse every result.

## Sign in

```sh
gog-achievements auth login
```

Complete sign-in in the **Sign in to GOG** window that opens. The same command captures GOG's registered callback, closes the window, saves your login in the native credential store and confirms sign-in. With `--json`, it returns `authenticated: true`. It requires no copied URL or second command. On macOS, the window uses a nonpersistent WebKit session. Windows uses an InPrivate WebView2 profile in a temporary data folder and attempts to remove that folder when the window closes.

The command waits up to three minutes for sign-in. Use `auth login --timeout 300` to allow five minutes. Close the window or press Ctrl+C to cancel. Progress appears on stderr; stdout contains the final result.

GOG's Galaxy OAuth client rejects local callback URLs with `redirect_uri_mismatch`. The native window keeps the registered GOG redirect URL and intercepts it inside the native web view. It captures only the GOG callback in the main window and validates OAuth state when GOG returns it.

You can check the saved login with:

```sh
gog-achievements auth status
```

For manual sign-in, `auth login --no-open` returns the standard GOG login URL. Open that URL, complete sign-in, copy the final callback URL and run `auth finish --clipboard`. The URL contains a temporary login code; keep it on your computer and do not paste it into an AI chat or a command argument. `auth finish --stdin` also accepts the final URL or its code from a pipe. `auth import --stdin` accepts an existing refresh token from a pipe.

`auth logout` removes this tool's local login. It does not sign out GOG Galaxy or revoke other sessions.

Credentials use the `gog-achievements-cli` entry in Mac Keychain, or a Windows DPAPI-encrypted file at `%LOCALAPPDATA%\GogAchievementsCli\session.dpapi`. Windows encryption is bound to the current user and the folder has a user-only access rule. Commands, queues and reports do not contain tokens.

Background Mac credential reads do not open permission prompts. If a saved login needs new access permission, run `auth login` and allow the helper when macOS asks. Sign-in allows 30 seconds for this Keychain step; background native calls have a five second process limit. Packaged native helpers are cached by content hash in the user's cache folder so their path stays stable, and their content is checked before reuse.

## Find your game and achievements

```sh
gog-achievements games list --search Cyberpunk
gog-achievements achievements list --game 1423049311
```

Game IDs, client IDs, user IDs and achievement IDs are strings. GOG uses IDs larger than JavaScript's safe integer range; keep them as strings when editing files or parsing JSON.

`games list` reads every library page. `games list --ids-only` uses the quick owned-ID endpoint without titles. `achievements list` checks ownership and reads the game's achievement list, including hidden entries and unlock dates.

Text shows achievement names, full IDs, lock status and UTC dates. Add `--json` for descriptions and all other fields.

## Create and edit a queue

Replace `ACHIEVEMENT_ID` with an ID from the achievement list. Repeating `--achievement` selects more than one item.

```sh
gog-achievements queue create --game 1423049311 --file queue.json
gog-achievements queue add --file queue.json --achievement ACHIEVEMENT_ID
gog-achievements queue set-date --file queue.json --achievement ACHIEVEMENT_ID --unlocked-at 2026-10-01T18:30:00+01:00
gog-achievements queue show --file queue.json
gog-achievements queue remove --file queue.json --achievement ACHIEVEMENT_ID
```

You can also select achievements and set their date in `queue create` or `queue add`. Each item has its own `unlocked_at` field. When no date is set, the tool uses ten seconds before queue creation or addition. Dates require an explicit time zone, use second precision, and cannot be in the future.

Queue edits only change the local file. A queue is bound to the signed-in account and one game's Galaxy client. Create refuses to overwrite an existing file. Edit and apply use a `.lock` file to stop concurrent CLI operations. If the process is killed, check the PID in the lock file before removing that stale lock.

Queue format, with placeholder IDs:

```json
{
  "schema_version": 1,
  "user_id": "USER_ID",
  "game": { "id": "GAME_ID", "title": "Cyberpunk 2077", "client_id": "CLIENT_ID" },
  "created_at": "2026-10-01T17:30:00Z",
  "updated_at": "2026-10-01T17:30:00Z",
  "items": [
    {
      "achievement_id": "ACHIEVEMENT_ID",
      "key": "ACH_KEY",
      "name": "Achievement name",
      "unlocked_at": "2026-10-01T17:30:00Z"
    }
  ]
}
```

The IDs in a real queue must be positive decimal strings. The CLI rejects unknown fields, duplicate achievements, invalid dates and null dates.

## Preview and apply

```sh
gog-achievements queue apply --file queue.json --dry-run
gog-achievements queue apply --file queue.json --yes
```

Without `--yes`, apply is a preview. It checks the whole queue, game ownership, account and live achievement keys before a write. During apply it reads each achievement again before writing and skips achievements that are already unlocked. Keep the game closed during apply: the GOG API does not offer an atomic compare-and-set operation.

Apply uses game-scoped authentication, writes each selected date, and reads the achievement state back. A lost write response is reconciled by reads; the CLI does not repeat that POST automatically. It stops after a failure or an unconfirmed result. The queue stays available for review and retry.

| Result status                  | Meaning                                                             |
| ------------------------------ | ------------------------------------------------------------------- |
| `pending`                      | Valid selection in a preview; no write was made.                    |
| `restored`                     | The remote unlock and requested date were confirmed.                |
| `skipped_already_unlocked`     | Already earned remotely; no write was made.                         |
| `restored_with_different_date` | Unlock confirmed, but GOG returned a different date.                |
| `failed`                       | GOG rejected the write and the unlock was not confirmed.            |
| `unconfirmed`                  | The write or readback could not be confirmed. Check the live state. |
| `not_attempted`                | Apply stopped before this item was written.                         |

Exit 6 shows the full report in text mode or under `error.details.report` in JSON mode. Inspect it before retrying. A retry skips existing unlocks; it does not edit their dates.

## Machine contract

With `--json`, every command returns one JSON object on stdout, with no prompts or diagnostic text mixed into it. Add `--pretty` to indent the JSON. The success and error envelopes, string IDs, queue schema and exit codes are unchanged.

```json
{ "ok": true, "data": {} }
```

```json
{ "ok": false, "error": { "code": "AUTH_REQUIRED", "message": "Sign in with auth login." } }
```

| Exit | Meaning                                                            |
| ---- | ------------------------------------------------------------------ |
| 0    | Command completed; for login start, read `action_required`.        |
| 2    | Invalid input or queue file.                                       |
| 3    | Login needed or rejected.                                          |
| 4    | Network or API response failure.                                   |
| 5    | Account, ownership, game or queue lock conflict.                   |
| 6    | Apply incomplete; read the per-achievement report.                 |
| 7    | Native credential store, browser runtime or local process failure. |

HTTP requests have a 15 second timeout; background credential operations have a 5 second process limit. Mac credential saving during sign-in allows 30 seconds for local permission approval. Automatic login waits up to 180 seconds for the window response by default, then uses the normal API and Keychain limits. Manual login stdin waits at most 30 seconds. The CLI rejects redirects for API requests and does not print raw server bodies, tokens or credential URLs in errors.

## Validation and current limits

```sh
npm run check
npm run test:coverage
npm run demo
```

`demo` uses fixture data and prints the complete CLI flow. It makes no requests to GOG and does not access your login.

The suite covers every command, queue and account checks, native IPC, cancellation, paging, response validation and apply reconciliation. CI enforces coverage gates, tests native callback/config validation and temporary credential storage, and smoke-tests each executable outside the source checkout. See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

Native tests use temporary credentials. Live GOG browser sign-in and actual achievement writes remain manual checks. Date handling is tested with fixtures; server date limits have not been verified through a real achievement write.

GOG's gameplay request accepts a `date_unlocked` field in the referenced tools. This implementation supports that field and checks the returned date, but server date limits are not verified on a real account. It does not change dates on already unlocked achievements or edit game statistics. The tool restores platform records; it does not repair the game's future achievement triggers.

The CLI uses GOG web endpoints and GOGDB build metadata. These web endpoints are unofficial and can change.

Protocol references: [GOG account/auth API notes](https://github.com/Yepoleb/gogapidocs), [timendum's achievement requests](https://github.com/timendum/gog_achievements/blob/master/internal/gog.go), [Heroic's GOG authentication](https://github.com/Heroic-Games-Launcher/heroic-gogdl/blob/main/gogdl/auth.py). This project has its own implementation; it does not copy the upstream app source.
