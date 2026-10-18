# CLI reference

Use the [README](../README.md) for installation, examples and the LLM agent workflow. This reference covers command options, authentication, queue files and operational limits.

## Command options

All commands accept `--json`, `--pretty` and `--help` (`-h`). Flags in the required column must be supplied. `auth finish` requires exactly one input source; `auth import` requires `--stdin`.

| Command               | Required flags                                               | Optional flags                                                         |
| --------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `auth login`          | None                                                         | `--no-open`, `--timeout SECONDS`                                       |
| `auth status`         | None                                                         | None                                                                   |
| `auth logout`         | None                                                         | None                                                                   |
| `auth finish`         | `--stdin` or `--clipboard`                                   | None                                                                   |
| `auth import`         | `--stdin`                                                    | None                                                                   |
| `games list`          | None                                                         | `--search TEXT` or `--ids-only`                                        |
| `achievements list`   | `--game GAME_ID`                                             | `--search TEXT`, `--status all\|locked\|unlocked`                      |
| `achievements export` | `--game GAME_ID`, `--file PATH`                              | `--search TEXT`, `--status all\|locked\|unlocked`                      |
| `queue create`        | `--game GAME_ID`, `--file PATH`                              | `--achievement ID`, `--unlocked-at TIMESTAMP`, `--action unlock\|lock` |
| `queue add`           | `--file PATH`, `--achievement ID`                            | `--unlocked-at TIMESTAMP`, `--action unlock\|lock`                     |
| `queue remove`        | `--file PATH`, `--achievement ID`                            | None                                                                   |
| `queue set-date`      | `--file PATH`, `--achievement ID`, `--unlocked-at TIMESTAMP` | None                                                                   |
| `queue show`          | `--file PATH`                                                | None                                                                   |
| `queue apply`         | `--file PATH`                                                | `--dry-run` or `--yes`                                                 |
| `doctor`              | None                                                         | None                                                                   |
| `self update`         | None                                                         | `--check` or `--yes`                                                   |

Repeat `--achievement` to select more than one ID. `games list --search` requires titles and cannot be combined with `--ids-only`. `auth login --no-open` cannot be combined with `--timeout`. `queue apply --yes` cannot be combined with `--dry-run`.

`queue create` and `queue add` use `--action unlock` by default. Use `--action lock` to capture currently unlocked achievements and their original dates. All IDs in that command use the same action. Add another action in a separate `queue add` call to build a mixed queue. `--action lock` cannot be combined with `--unlocked-at`. `queue set-date` rejects its entire selection if any selected entry is a lock.

`games list` reads all library pages. `--ids-only` uses the owned-ID endpoint without titles. `achievements list` checks ownership and includes hidden entries. Its text output shows names, full IDs, lock status and UTC dates; JSON also includes descriptions and other fields.

`achievements list --search TEXT` matches names and descriptions without case sensitivity. Leading and trailing spaces are ignored; an empty search keeps every entry. Combine it with `--status all|locked|unlocked` (default: `all`). The result keeps source order and the same JSON fields; `count` is the number of matching achievements. Without either option, results stay unchanged, including hidden entries. These options make no achievement writes.

```sh
gog-achievements achievements list --game GAME_ID --search city --status locked --json
```

Source consumers can import `filterAchievements(achievements, { search, status })` from the public entry point to use the same selection for CSV export. It returns matching entries in source order without changing the input or achievement fields.

Use the installed executable's `--help --json` output to discover its command contract. Source users can run `node bin/gog-achievements.mjs --help --json`.

## CSV export

`achievements export --game GAME_ID --file PATH` writes these columns in order:

```text
game_id,game_title,achievement_id,name,description,hidden,status,unlocked_at
```

Optional `--search TEXT` and `--status all|locked|unlocked` use the same shared filter as `achievements list`. Selection preserves source order and includes hidden names and descriptions. The file uses UTF-8, comma separators, CRLF record endings and standard double-quote escaping for commas, quotes and line breaks. IDs retain their exact digits. `hidden` is `true` or `false`; `status` is `locked` or `unlocked`. Unlock dates use UTC RFC 3339 timestamps ending in `Z`; locked dates are empty. No matches still produce the header.

CSV is written only to `PATH`. Readable stdout confirms the saved absolute path and row count. JSON stdout uses the normal success envelope with `data.path` and `data.count`. Existing files, directories and links are never replaced; `EXPORT_EXISTS` exits with 2. Other file failures return `EXPORT_WRITE_FAILED` with exit 2. Data retrieval failures keep their existing codes and create no export file. Concurrent exports cannot overwrite each other. Export does not modify achievements or queues.

## CLI updates and recovery

`self update --check` reads public GitHub release metadata and reports `current_version`, `latest_version`, `update_available`, `release_url` and `can_update`. If the installation cannot replace itself, `instructions` describes the supported update method. It does not download a release archive, change files or require GOG sign-in.

`self update` uses only the latest stable published release for the current OS and architecture. It never downgrades. When an update is available, interactive text mode asks for confirmation. Use `--yes` to install from a script or JSON call. `--check` and `--yes` cannot be combined. A declined confirmation returns `UPDATE_CONFIRMATION_REQUIRED` with exit 2.

Installation requires a complete standalone package with its original executable name and write access to its folder. Source and package manager installations must use their original update method. A CLI bundled in the desktop app must be updated through that app.

Downloads have time and size limits. The updater verifies the published SHA-256 checksum, rejects unsafe archive paths and links, validates the package version and platform, and runs the new executable's JSON help command before and after replacement. SHA-256 detects changed bytes; it is not a publisher signature. Releases do not yet have trusted signing or notarization.

Only tool-owned files are replaced. Credentials and queue files stay unchanged. The previous files remain in the reported `backup_directory`; successful JSON output includes `updated: true`, `previous_version`, and the new `current_version`. When no newer version is available, it reports `updated: false`. Windows renames the running executable into the backup and keeps it there; no detached updater or scheduled work is used. You can remove old backup folders after you have confirmed that the new version works and the update command has exited.

An installation failure attempts to restore the previous files. If that fails, `UPDATE_RECOVERY_REQUIRED` (exit 7) includes the backup location. Restore the backup's tool files into the original package folder before another update. Keep your queue files in place.

The file `.gog-achievements-update.lock` prevents concurrent updates. A forced shutdown can leave it behind. Read it for the backup location, make sure no update is running, restore any moved tool files from that backup, and then remove the lock. Do not remove another running updater's lock.

Successful automatic `auth login` in text mode checks once, with a two-second network limit. It prints a notice to stderr only if a newer release is available and this standalone installation can update itself. Update errors do not change the login result. JSON login, manual login URL generation, other commands and help do not trigger a check. There are no daily or background checks, cached checks, automatic downloads or automatic installations.

## Authentication

### Native sign-in

`auth login` opens a controlled native window and completes sign-in in one command. It captures GOG's registered callback, saves the session, closes the window and returns the final result. `--json` returns `authenticated: true` after successful automatic sign-in. Progress goes to stderr.

macOS uses a nonpersistent WebKit session. Windows uses an InPrivate WebView2 profile in a temporary data folder and attempts to remove the folder after the window closes. Windows needs the [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/).

GOG's Galaxy OAuth client rejects custom loopback redirects with `redirect_uri_mismatch`. The helper keeps the exact registered GOG redirect URL and intercepts it in the main web view. It validates OAuth state when GOG returns it. Login codes travel through private helper IPC and never reach CLI stdout.

### Manual sign-in and token import

Run `auth login --no-open` locally to get a GOG login URL. Open it, complete sign-in, then copy the final callback URL and run `auth finish --clipboard`. This first command returns `authenticated: false` and `action_required: "complete_manual_browser_login"`; exit 0 means the URL was produced, not that sign-in is complete.

`auth finish --stdin` accepts a callback URL or its code from a pipe. `auth import --stdin` accepts an existing refresh token. Keep login codes and plaintext tokens out of arguments, files, logs, reports and chat. Supply them only through the local clipboard or a private pipe.

### Credential storage

| Platform | Storage                                                                                                                      |
| -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| macOS    | Mac Keychain service `gog-achievements-cli`.                                                                                 |
| Windows  | `%LOCALAPPDATA%\GogAchievementsCli\session.dpapi`, encrypted with CurrentUser DPAPI and protected by a user-only folder ACL. |

`auth status` reads saved credentials without revealing tokens. `authenticated: true` means a session is stored. If `expired: true`, the next GOG command can refresh its access token. `auth logout` removes this tool's local session; it does not revoke other sessions or sign out GOG Galaxy.

Background Mac credential reads do not open approval dialogs. If saved credentials need new access permission, run `auth login` and allow the helper when macOS asks. Packaged helpers are cached by content hash in the user's cache folder so their path stays stable. Their bytes are checked before reuse.

### Troubleshooting sign-in

- **Login button stays disabled:** wait for GOG's Cloudflare Turnstile check. The native window permits HTTPS challenge frames and their embedded documents, as required by [Turnstile's WebView guidance](https://developers.cloudflare.com/turnstile/get-started/mobile-implementation/). If the check fails, close the window and retry.
- **Sign-in times out:** the default window wait is 180 seconds. Use `auth login --timeout 300` for five minutes; the accepted range is 10 to 600 seconds. Close the window or press Ctrl+C to cancel.
- **Keychain access fails:** run `auth login` to permit an explicit local approval. Background credential calls have a five second limit; Mac credential saving during sign-in allows 30 seconds for permission approval.
- **WebView2 is missing:** install the runtime from the Microsoft link above, then retry sign-in.

## Queue files

Use `queue create` and `queue add` to capture IDs and achievement keys from GOG. Queues are bound to one user and one game's Galaxy client. Creating or editing a queue makes no achievement writes, although creation and addition read live GOG data.

A queue uses schema version 1. The following IDs are illustrative; use the IDs returned for your account and game:

```json
{
  "schema_version": 1,
  "user_id": "100000000000000001",
  "game": {
    "id": "1423049311",
    "title": "Cyberpunk 2077",
    "client_id": "100000000000000002"
  },
  "created_at": "2026-10-01T17:30:00Z",
  "updated_at": "2026-10-01T17:30:00Z",
  "items": [
    {
      "achievement_id": "100000000000000003",
      "key": "ACH_KEY",
      "name": "Achievement name",
      "unlocked_at": "2026-10-01T17:30:00Z"
    }
  ]
}
```

All IDs must be positive decimal strings. A queue can hold up to 1,000 achievements. An achievement can occur only once, even with different actions. Unknown fields, unknown actions, invalid dates and null unlock dates are rejected. Each requested `unlocked_at` must be an RFC 3339 timestamp with an explicit time zone, at or before the current time. Dates are normalised to UTC at second precision. Unlock creation and addition default to ten seconds before that operation.

An item without `action` retains its existing meaning: unlock with the given date. Explicit unlock entries add `"action": "unlock"`. Lock entries contain `"action": "lock"` and a non-null `previous_unlocked_at` copied exactly from GOG, including its offset and precision. Lock entries must omit `unlocked_at`; unlock entries must omit `previous_unlocked_at`. The version remains `1`. Existing default unlock commands keep their original JSON shape. Older CLI and desktop consumers reject lock entries, so callers must use a CLI release with `--action` in its JSON help.

For example, a second item in the queue above could be:

```json
{
  "achievement_id": "100000000000000004",
  "key": "OTHER_ACH_KEY",
  "name": "Achievement to lock",
  "action": "lock",
  "previous_unlocked_at": "2026-09-01T12:00:00+0000"
}
```

Create refuses to overwrite an existing file. Queue operations that change the file or apply it hold a `<queue path>.lock` for the complete operation, including remote apply requests. If a process is killed and leaves a lock, check the PID recorded in it. Remove the lock only after confirming that process is no longer active. `queue show` only reads the file and needs no network access.

### Apply behaviour

Apply previews unless `--yes` is supplied. Before any write, the CLI validates the entire queue, signed-in account, game ownership, current achievement keys and original dates for pending locks. It uses game-scoped authentication and reads each achievement again before writing. Unlock requests preserve existing unlocks. Lock requests skip already locked entries. If a selected achievement is still unlocked but its date differs from `previous_unlocked_at`, apply stops with `ACHIEVEMENT_CHANGED`; remove and re-add that lock request to review the current date.

After each write, it reads the achievement state back. If the write response is lost, it reconciles the result with reads and does not repeat the POST automatically. A failure, unconfirmed result or returned date mismatch stops further writes. The queue file remains available for review. See the README's [item statuses and exit codes](../README.md#apply-results); incomplete reports use exit 6 and `error.details.report` in JSON mode.

A retry skips achievements already in their requested state. It cannot correct an existing unlock's date. The CLI applies entries in queue order; a partial batch keeps earlier confirmed changes and does not roll them back. The saved queue remains unchanged after apply, including original dates. Capture the JSON result if you also need a saved per-item report.

Lock reports contain `action: "lock"`, `requested_unlocked_at: null`, the saved `previous_unlocked_at`, and the observed `actual_unlocked_at`. Status `locked` requires a fresh, explicit locked state for the same achievement ID and key. `skipped_already_locked` confirms that no write was needed. A missing achievement, read failure or success response without a confirmed state is not a confirmed lock. An observed null date in an `unconfirmed` result is not proof of success.

Keep the game closed during apply because the API has no atomic compare-and-set operation. Clearing platform achievements does not reset saves or game statistics. Later game activity or pending Galaxy synchronization may unlock them again.

## Time limits and output

| Operation                            | Limit                                                        |
| ------------------------------------ | ------------------------------------------------------------ |
| HTTP request                         | 15 seconds per request.                                      |
| Background credential helper         | 5 seconds per process.                                       |
| Mac credential saving during sign-in | 30 seconds for local approval.                               |
| Automatic login window               | 180 seconds by default; configurable from 10 to 600 seconds. |
| Manual login stdin                   | 30 seconds.                                                  |

The window timeout applies to the browser step. Token exchange and credential saving then use their own limits. A command can make several API requests, so a request timeout is not a total command timeout.

With `--json`, stdout contains one result object, even on an error. Capture stderr separately for progress. `--json --pretty` indents the object; `--pretty` alone still produces text. Format does not change when output is piped. Scripts that used the earlier JSON default must now pass `--json`.

The CLI rejects redirects on API requests. Errors do not print raw server bodies, tokens or credential URLs.

## Protocol references

The CLI uses unofficial GOG web endpoints and GOGDB build metadata. These can change independently of the CLI. It supports the `date_unlocked` field used in the referenced achievement requests and checks the state returned by GOG. Only the explicit lock adapter sends `date_unlocked: null`; the unlock adapter still rejects null dates. Server date limits, live re-lock behavior and Galaxy display refresh remain unverified through a real account write.

- [GOG account and authentication API notes](https://github.com/Yepoleb/gogapidocs)
- [timendum's achievement requests](https://github.com/timendum/gog_achievements/blob/master/internal/gog.go)
- [GOG SDK clearing achievements](https://docs.gog.com/sdk-stats-and-achievements/#clearing-achievements)
- [Heroic's GOG authentication](https://github.com/Heroic-Games-Launcher/heroic-gogdl/blob/main/gogdl/auth.py)

This project has its own implementation; it does not copy the upstream app source.
