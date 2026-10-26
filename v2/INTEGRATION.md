# Integration review

This is an external Rust executable, schema 3 / runtime rust / execution process /
protocol 1, canonical `com.tezbar.native.text-differ`. It replaces exactly the own
manifest ID `com.tezbar.text-differ` and pinned Recommended ID `raycast.text-differ`.
The host's `loved_extensions.json` at ea100 confirms the repository, command,
description and original PNG. No catalog, app, SDK or profile changes were made.

## Actual host calls

Only `selection.read` and `clipboard.write` are granted.

`host.selection.read {kind:"files"}` routes in `extensions/process_host.rs` to
`selected_files()`. macOS obtains Finder selection URLs (first 128), parses local
file URLs and returns absolute regular-file PathBufs as JSON strings. Windows
uses the foreground Explorer HWND and Shell.Application SelectedItems in returned
order, first 128. Output is bounded to 1 MiB and a 10-second producer timeout;
nonabsolute/non-file entries are filtered. The adapter separately validates the
array, path types/count/length and exactly-two requirement. QA supplies this
producer's validated shape using **owned synthetic files only**. Real Finder,
foreground Explorer, selection permissions and Windows foreground timing remain
live-platform acceptance work. No invented file picker, launch-file property,
argument path or host method is needed: the actual command has no such input.

`host.clipboard.write {text}` routes without HTML to `clipboard:write`.
`NativeCore::dispatch` reaches `LauncherCore::handle`, then `ClipboardCore` calls
`write_text` / `arboard::Clipboard::set_text`. Only completion returns `{ok:true}`;
errors propagate. The adapter accepts a closed object with `ok:true` and optional
string `message`. Null, booleans, extra keys, contradictory errors and non-string
messages do not report success. No generic permissive ACK parser is used.
The pinned JS `registerAction`/`copyToSystemClipboard` functions also confirm
that this source Copy action writes the full string and does not hide/paste/open.
Those exact functions execute inside the closed oracle VM with a synthetic write
sink. The original effect audit preview's 2000-character bound does not truncate
the actual copy value. No clipboard read, shell, settings, window or paste call
is used; their unrelated contracts are not claimed as exercised.

## Views, revisions and lifetime

The existing Detail root and `markdown` property are used. Escaped preformatted
HTML has a fixed trusted wrapper and no `code` child, so the pinned Markdown
renderer cannot attach its own code-copy buttons. Native hostile file content
is rendered by the actual pinned Detail/Markdown code with locked host renderer
dependencies in jsdom. User text creates no anchors/images/scripts/actions.
CR/backslash display escaping is explained in the view. Color highlighting is
not claimed. `refreshMs:null` is present in both command metadata and responses.

SDK session state stages new comparison results and commits them only on current
success. A bounded per-session authority records consumed IDs before await and
holds only the explicitly prepared recovery. Copy retries never read/re-diff.
An SDK-owned pending cleanup future holds a drop guard: canceled opens, session
scope cancellation, EOF and shutdown remove the registry even if the future was
never polled. This is not a detached task, timer, poller or background lease.
The adapter caps 128 entries and 256-byte session identities. There are no stored
user paths/content after session/process teardown and no disk domain storage.
Latest-search traffic is inert because this command has no search input. Old
IDs must match the SDK-committed screen and must not have been consumed; other
sessions/file pairs and A–B–A transitions cannot revive an old action.

## Separate, unapplied generic host patch

[integration/host-prerequisites.patch](integration/host-prerequisites.patch) is
based only on ea100 fixtures. It contains these used prerequisites:

1. Separate active-version **resource_path** from canonical managed **path** in
   registry entries. Icons resolve in the active version while preferences,
   retention and uninstall stay rooted at the canonical package. Preference and
   uninstall logic is byte-identical; exact before/after icon/preference fixtures
   compile independently. Retention's constructor initializes the added field.
2. Resolve only exact aliases of installed verified healthy manifests with a Rust
   command covered on the current platform. Reject ambiguous candidates, identity
   mismatches, damaged/unverified entries, uncovered commands and lookalikes.
   This new extension is absent from the built-in Rust catalog; no catalog entry
   is added. Actual alias/resource functions are compiled from pinned/patched
   fixtures; verification remains owned by the existing `collect`/`resolve` path.
3. Wrap only Detail primary-action/actions-button callbacks so a MouseEvent does
   not become an action ID or filter. The actual pinned renderer reproduces the
   pre-patch failure and passes with this patch, including real jsdom clicks and
   keyboard Enter. Grid/List/Form/no-view behavior is untouched.

The patch is never applied to the concurrent app. No new ACK host patch or unused
List/Form/no-view patch bundle is included. Tests are scoped extraction/renderer
fixtures, not a full host/Tauri build, package installation or live GUI claim.

## Parent-owned publication gates

Review the branch, patch and notices. Actual target release builds, Windows native
validation, live selected-file/clipboard acceptance, artifact acquisition URLs,
trusted catalog pins, installation and publication remain separate parent work.
The dev ZIP has a complete closed file inventory but empty artifacts; pinned
runtime `artifact_for` correctly rejects it as a published release. No target
URLs/hashes are invented in the source manifest. Generic schema/target/path
functions are exercised directly from the pinned runtime source.
