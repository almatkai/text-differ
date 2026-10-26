# Verification record — development review

All domain tests use only owned files under ignored `v2/.qa`. No actual Finder/
Explorer selection, Documents/Downloads, OS clipboard, editor/browser, live GUI,
app profile or sibling working files were used. The app and SDK were inspected
only through exact pinned Git objects. No commit, push, PR, install, release,
app/SDK/catalog mutation, clone deletion or subdelegation occurred.

Run `python3 v2/scripts/validate.py` from the clone to reproduce the complete
local suite with already installed Rust/Node/Python tools. It reconstructs an
exact source-commit V1 copy and root lock, runs npm with lifecycle scripts disabled,
and keeps HOME/TMP/caches/build outputs/private synthetic profiles inside `.qa`.
The product executable requires no Node, JS helper, Tauri or app build.
`python3 v2/scripts/verify_provenance.py` checks immutable visible fixtures and
V1 byte preservation without requiring any SDK/app sibling.

## Passed locally

- Stable Rust **1.98.0** and MSRV **1.85.0**: fmt check, six production core/adapter
  tests, strict all-target Clippy (`-D warnings`), native builds and process QA.
- **1361** oracle comparisons per executable run. The complete own command TSX,
  exact locked jsdiff line/base/params sources, and pinned real CopyToClipboard
  worker functions execute inside a closed VM with synthetic selection/file-read/
  clipboard-write producers. Unmocked imports, FS, OS, process, network, timers,
  selection and clipboard access are denied. The source's actual copy value is
  compared with the native reverse-RPC text; expected diffs are not a rewritten
  mirror. Actual source/native samples are in `evidence/oracle-actual-samples.json`.
- Empty, identical, one-sided, inserted/deleted/changed/reordered lines, duplicates,
  exhaustive small binary-token ties, seeded cases, CRLF/lone CR/LF, EOF newlines,
  BOM, invalid UTF-8 replacements, emoji, 60000-byte lines and hostile file text/
  filenames. Component counts/order are observable in actual oracle samples.
  NUL/control, bytes/combined bytes, lines and quadratic work have explicit error
  tests. Native unit QA also changes an owned file between read chunks and tests
  a selected regular symlink, non-file FIFO and directories. The source has no
  counters/context preference/open/refresh actions to invent or claim as tested.
- Real SDK JSONL pipes: successful opening and automatic comparison; source read
  failure; selection/count/type failures; same path/order; inaccessible/missing/
  directory/control/limit failures; same-input manual read retry; source snapshot
  unaffected by later file edits; host refresh without rereading; stale consumed
  IDs; pair/session replacement; concurrent latest A–B–A inert searches; canceled
  ordinary retry without committing a new snapshot; strict clipboard ACK negatives,
  reverse RPC errors, exact prepared retry, cancellation/late ACK and disposal;
  EOF with an active reverse request; 128 sessions plus rejection and disposal;
  **140 canceled opens** followed by a working open; two empty isolated private
  profile directories. `--protocol-info` is not counted as domain verification.
- Actual pinned schema with seven negative mutations, pinned runtime artifact/
  target/path functions and alias gate, and exact before/after host prerequisites.
  Five extracted Rust fixture tests compile without the app. Actual pinned
  Detail/Markdown/Surface code executes with the pinned direct renderer versions
  and an exact separate QA dependency lock in jsdom. Real synthetic MouseEvents
  reproduce the original bad callback and verify the wrapper, keyboard Enter and
  action opening. Native-produced hostile preformatted text creates zero links,
  images, scripts, code-copy buttons or OS effects. Reversible CR/backslash display
  is intentional, not a claim of byte-preserving HTML serialization.
- Disposable exact-root-lock V1 smoke test and TypeScript typecheck.
- Windows GNU `cargo check --locked --all-targets` on the final source.
- Fresh isolated Cargo home fetched SDK over immutable HTTPS Git and built the
  production ARM64 release executable independently, with no sibling/app path.
- Ignored ARM64 dev ZIP: **100** exact members, complete manifest file inventory
  (excluding self), all extracted bytes/digests verified. The extracted production
  executable runs the full 1361-case oracle and success/error/cancel pipe suite;
  its output is then tested by the actual pinned renderer. This is no installation.

## Blocked or not run

Windows GNU linking was attempted: missing `x86_64-w64-mingw32-dlltool`.
MSVC checking was attempted: its target std/core is not installed. No toolchain,
linker or OS dependencies were installed. Windows linked execution, native OS
selection/clipboard, full host/Tauri build, real GUI, package install and release
acceptance are **not run**. Inactive CI YAML is a review template, not evidence.
The host prerequisite patch remains unapplied. The dev manifest has empty
artifacts and the actual pinned runtime rejects it as a published artifact.

`r-efi 6.0.0` lacks full license files in the locked crate; authentic supplied
README/AUTHORS and an explicit missing-text flag are retained. It is not compiled
for macOS/Windows. No replacement legal grant is invented.

The initial XERJ namespace is `ax-eca10337d9d5`, derived from the canonical clone
path. Its first generation indexed all five V1 code files, with an asset junk skip
(`completed-with-junk`): non-code coverage is incomplete. Final indexing failed because the frozen dataset rejects the new Cargo.toml
fields. Coverage is incomplete, recorded in `evidence/xerj.json`. Exact source,
rg and Git checks remain authoritative. No alternate prefix, global restart or
schema mutation was used.

## Review artifacts

[evidence/validation.json](evidence/validation.json) records commands, exit codes,
versions and validated production input hashes. [Logs](evidence/logs/) contain
actual results. [Provenance](evidence/provenance.json) hashes immutable source,
SDK, host and jsdiff fixtures. [Package inventory](evidence/package-inventory.json)
contains the real dev archive/executable hashes and every member. The ignored ZIP
is `v2/dist/text-differ-dev-aarch64-apple-darwin.zip`.
`evidence/INDEX.json` hashes every Git-visible file in the entire clone except
itself; all required source/test/tool lock inputs are visible, while generated
node_modules, caches, targets, ZIPs and disposable copies remain ignored.
