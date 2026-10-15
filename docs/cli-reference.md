# CLI reference

Use the [README](../README.md) for installation, examples and the LLM agent workflow. This reference covers command options, authentication, queue files and operational limits.

## Command options

All commands accept `--json`, `--pretty` and `--help` (`-h`). Flags in the required column must be supplied. `auth finish` requires exactly one input source; `auth import` requires `--stdin`.

| Command             | Required flags                                               | Optional flags                                |
| ------------------- | ------------------------------------------------------------ | --------------------------------------------- |
| `auth login`        | None                                                         | `--no-open`, `--timeout SECONDS`              |
| `auth status`       | None                                                         | None                                          |
| `auth logout`       | None                                                         | None                                          |
| `auth finish`       | `--stdin` or `--clipboard`                                   | None                                          |
| `auth import`       | `--stdin`                                                    | None                                          |
| `games list`        | None                                                         | `--search TEXT` or `--ids-only`               |
| `achievements list` | `--game GAME_ID`                                             | None                                          |
| `queue create`      | `--game GAME_ID`, `--file PATH`                              | `--achievement ID`, `--unlocked-at TIMESTAMP` |
| `queue add`         | `--file PATH`, `--achievement ID`                            | `--unlocked-at TIMESTAMP`                     |
| `queue remove`      | `--file PATH`, `--achievement ID`                            | None                                          |
| `queue set-date`    | `--file PATH`, `--achievement ID`, `--unlocked-at TIMESTAMP` | None                                          |
| `queue show`        | `--file PATH`                                                | None                                          |
| `queue apply`       | `--file PATH`                                                | `--dry-run` or `--yes`                        |
| `doctor`            | None                                                         | None                                          |
| `self update`       | None                                                         | `--check` or `--yes`                          |

Repeat `--achievement` to select more than one ID. `games list --search` requires titles and cannot be combined with `--ids-only`. `auth login --no-open` cannot be combined with `--timeout`. `queue apply --yes` cannot be combined with `--dry-run`.

`games list` reads all library pages. `--ids-only` uses the owned-ID endpoint without titles. `achievements list` checks ownership and includes hidden entries. Its text output shows names, full IDs, lock status and UTC dates; JSON also includes descriptions and other fields.

Use the installed executable's `--help --json` output to discover its command contract. Source users can run `node bin/gog-achievements.mjs --help --json`.

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

All IDs must be positive decimal strings. A queue can hold up to 1,000 achievements. Unknown fields, duplicate achievements, invalid dates and null dates are rejected. Each requested `unlocked_at` must be an RFC 3339 timestamp with an explicit time zone, at or before the current time. Dates are normalised to UTC at second precision. Creation and addition default to ten seconds before that operation.

Create refuses to overwrite an existing file. Queue operations that change the file or apply it hold a `<queue path>.lock` for the complete operation, including remote apply requests. If a process is killed and leaves a lock, check the PID recorded in it. Remove the lock only after confirming that process is no longer active. `queue show` only reads the file and needs no network access.

### Apply behaviour

Apply previews unless `--yes` is supplied. Before any write, the CLI validates the entire queue, signed-in account, game ownership and current achievement keys. It uses game-scoped authentication and reads each achievement again before writing. Existing unlocks are preserved.

After each write, it reads the achievement state back. If the write response is lost, it reconciles the result with reads and does not repeat the POST automatically. A failure, unconfirmed result or returned date mismatch stops further writes. The queue file remains available for review. See the README's [item statuses and exit codes](../README.md#apply-results); incomplete reports use exit 6 and `error.details.report` in JSON mode.

A retry skips achievements that are now unlocked. It cannot correct their dates. Keep the game closed during apply because the API has no atomic compare-and-set operation.

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

The CLI uses unofficial GOG web endpoints and GOGDB build metadata. These can change independently of the CLI. It supports the `date_unlocked` field used in the referenced achievement requests and checks the date returned by GOG. Server date limits remain unverified through a real account write.

- [GOG account and authentication API notes](https://github.com/Yepoleb/gogapidocs)
- [timendum's achievement requests](https://github.com/timendum/gog_achievements/blob/master/internal/gog.go)
- [Heroic's GOG authentication](https://github.com/Heroic-Games-Launcher/heroic-gogdl/blob/main/gogdl/auth.py)

This project has its own implementation; it does not copy the upstream app source.
