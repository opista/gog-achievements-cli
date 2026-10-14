# GOG Achievements CLI

A small Mac CLI for restoring GOG achievements you already earned. It returns JSON for use by AI tools and has a shared Node core for a later Electron app.

## Setup

Requires Node 22 or later and an unlocked Mac login Keychain. The Keychain package includes Apple Silicon and Intel builds.

```sh
cd /Users/beau/Documents/projects/gog-achievements-cli
npm ci --ignore-scripts
node bin/gog-achievements.mjs doctor
node bin/gog-achievements.mjs --help --pretty
```

Use `node bin/gog-achievements.mjs` below, or install a local command with `npm install --global . --ignore-scripts`.

## Sign in

```sh
node bin/gog-achievements.mjs auth login
```

Complete sign-in in your browser. Copy the final GOG redirect URL from its address bar, then run:

```sh
node bin/gog-achievements.mjs auth finish --clipboard
node bin/gog-achievements.mjs auth status
```

The final URL contains a temporary login code. Keep it on your Mac; do not paste it into an AI chat or a command argument. `auth finish --stdin` also accepts the final URL or its code from a pipe. `auth import --stdin` accepts an existing refresh token from a pipe.

`auth login --no-open` returns the login URL without opening a browser. `auth logout` removes this tool's local login. It does not sign out GOG Galaxy or revoke other sessions.

Credentials stay in the `gog-achievements-cli` entry in Mac Keychain. Commands, queues and reports do not contain tokens.

## Find your game and achievements

```sh
node bin/gog-achievements.mjs games list --search Cyberpunk --pretty
node bin/gog-achievements.mjs achievements list --game 1423049311 --pretty
```

Game IDs, client IDs, user IDs and achievement IDs are strings. GOG uses IDs larger than JavaScript's safe integer range; keep them as strings when editing files or calling the shared core.

`games list` reads every library page. `games list --ids-only` uses the quick owned-ID endpoint without titles. `achievements list` checks ownership and reads the game's achievement list, including hidden entries and unlock dates.

## Create and edit a queue

Replace `ACHIEVEMENT_ID` with an ID from the achievement list. Repeating `--achievement` selects more than one item.

```sh
node bin/gog-achievements.mjs queue create --game 1423049311 --file queue.json
node bin/gog-achievements.mjs queue add --file queue.json --achievement ACHIEVEMENT_ID
node bin/gog-achievements.mjs queue set-date --file queue.json --achievement ACHIEVEMENT_ID --unlocked-at 2026-10-01T18:30:00+01:00
node bin/gog-achievements.mjs queue show --file queue.json --pretty
node bin/gog-achievements.mjs queue remove --file queue.json --achievement ACHIEVEMENT_ID
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
    { "achievement_id": "ACHIEVEMENT_ID", "key": "ACH_KEY", "name": "Achievement name", "unlocked_at": "2026-10-01T17:30:00Z" }
  ]
}
```

The IDs in a real queue must be positive decimal strings. The CLI rejects unknown fields, duplicate achievements, invalid dates and null dates.

## Preview and apply

```sh
node bin/gog-achievements.mjs queue apply --file queue.json --dry-run --pretty
node bin/gog-achievements.mjs queue apply --file queue.json --yes --pretty
```

Without `--yes`, apply is a preview. It checks the whole queue, game ownership, account and live achievement keys before a write. During apply it reads each achievement again before writing and skips achievements that are already unlocked. Keep the game closed during apply: the GOG API does not offer an atomic compare-and-set operation.

Apply uses game-scoped authentication, writes each selected date, and reads the achievement state back. A lost write response is reconciled by reads; the CLI does not repeat that POST automatically. It stops after a failure or an unconfirmed result. The queue stays available for review and retry.

| Result status | Meaning |
|---|---|
| `pending` | Valid selection in a preview; no write was made. |
| `restored` | The remote unlock and requested date were confirmed. |
| `skipped_already_unlocked` | Already earned remotely; no write was made. |
| `restored_with_different_date` | Unlock confirmed, but GOG returned a different date. |
| `failed` | GOG rejected the write and the unlock was not confirmed. |
| `unconfirmed` | The write or readback could not be confirmed. Check the live state. |
| `not_attempted` | Apply stopped before this item was written. |

Exit 6 returns the full report under `error.details.report`. Inspect it before retrying. A retry skips existing unlocks; it does not edit their dates.

## Machine contract

Every command returns one JSON object on stdout, with no prompts or diagnostic text mixed into it. `--pretty` adds indentation; `--json` is accepted and is the default.

```json
{ "ok": true, "data": {} }
```

```json
{ "ok": false, "error": { "code": "AUTH_REQUIRED", "message": "Sign in with auth login, then auth finish." } }
```

| Exit | Meaning |
|---|---|
| 0 | Command completed; for login start, read `action_required`. |
| 2 | Invalid input or queue file. |
| 3 | Login needed or rejected. |
| 4 | Network or API response failure. |
| 5 | Account, ownership, game or queue lock conflict. |
| 6 | Apply incomplete; read the per-achievement report. |
| 7 | Mac Keychain or local process failure. |

HTTP requests have a 15 second timeout; Keychain operations have a 5 second cancellation signal. Login stdin waits at most 30 seconds. The CLI rejects redirects for API requests and does not print raw server bodies, tokens or credential URLs in errors.

## Shared core and Electron phase

```js
import { GogAchievements } from './src/index.mjs';

const gog = new GogAchievements();
const games = await gog.listGames();
const achievements = await gog.listAchievements('1423049311');
const queue = await gog.createQueue('1423049311', ['ACHIEVEMENT_ID']);
const preview = await gog.applyQueue(queue); // default: dry run
// Only after the selected changes are authorized:
const report = await gog.applyQueue(queue, { dryRun: false });
```

The later Electron app will use this core in its main process. Its flow is:

1. Sign in with GOG and read the user's game list.
2. Select a game and read its achievements.
3. Queue selected achievements and adjust each queued date.
4. Show a preview, apply the queue, and display each confirmed or failed result.

Use a narrow preload/IPC interface for these operations. Keep credentials and network calls in the main process. The renderer receives game data, queue data and reports. This phase is not implemented yet.

## Validation and current limits

```sh
npm run check
npm test
npm run demo
```

`demo` uses fixture data and prints the complete CLI flow. It makes no requests to GOG and does not access your login.

Verified on this Mac: CLI execution, long-session native Keychain round trip, public Cyberpunk GOGDB metadata, and automated queue/auth/API tests. The authenticated GOG library and achievement reads and a real achievement write still need a user login and a selected earned achievement.

GOG's gameplay request accepts a `date_unlocked` field in the referenced tools. This implementation supports that field and checks the returned date, but server date limits are not verified on a real account. It does not change dates on already unlocked achievements or edit game statistics. The tool restores platform records; it does not repair the game's future achievement triggers.

The core uses GOG web endpoints and GOGDB build metadata. These web endpoints are unofficial and can change.

Protocol references: [GOG account/auth API notes](https://github.com/Yepoleb/gogapidocs), [timendum's achievement requests](https://github.com/timendum/gog_achievements/blob/master/internal/gog.go), [Heroic's GOG authentication](https://github.com/Heroic-Games-Launcher/heroic-gogdl/blob/main/gogdl/auth.py), and [native Keychain package](https://github.com/Brooooooklyn/keyring-node). This project has its own implementation; it does not copy the upstream app source.
