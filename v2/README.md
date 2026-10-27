# Text Differ — standalone Rust V2

Feature branch review, not an installed or published release. This directory
contains the independent executable for **Compare Selected Files**
(`open-with-text-differ`). V1 remains intact above it.

Run the command after selecting exactly two text files in Finder/File Explorer.
Selection order determines left/right. Comparison starts immediately. Copy Diff
copies the prepared result without reading files again. Both-empty inputs have
no Copy action; identical nonempty inputs retain their context block. Selecting
the same path twice compares its two reads, as V1 does.

The source has no launch arguments, preferences, counters, configurable context,
Refresh, opening/editing/deleting/merging files, or persistence. Unused historic
application-discovery helpers in V1 are not invoked by its actual command.

The port translates locked jsdiff **8.0.4** rather than substituting another diff
heuristic. It keeps component order, default equality, removal on equal-position
ties, CRLF/lone CR/LF, EOF newlines, empty lines, Unicode, UTF-8 replacement and
BOM. V1 prefixes each *component* once, including multi-line components; this
unusual copy format is preserved. No extra unified-diff headers are invented.

Detail displays escaped preformatted text in the pinned renderer. It is
monochrome, without Markdown code buttons, links, images, or active file HTML.
The renderer reparses HTML and normalizes CR. Therefore display uses reversible
`\\` for backslash and `\r` for CR, with a visible legend when needed. Copy Diff
retains the original prepared string. V1's backtick replacement applies only to
its Markdown display; this inert display retains the actual backticks.

Read/selection failures expose Retry Comparison. A failed file read retries the
same pair; a selection/count failure explicitly requests selection again. Copy
failure or cancellation never automatically replays an OS operation. Its explicit
Retry Copy Diff reuses exactly the prepared text. Closing/reopening the command
is how V1 selects another pair. Host refresh requests return the current snapshot
or cancellation recovery; they do not reread files. Views use `refreshMs:null`.

Files are read-only, regular-file handles. Selected symlinks to regular files are
supported. Reads use metadata bounds, 16 KiB chunks, handle metadata rechecks,
and cooperative yield points. UNIX opens use nonblocking mode to avoid a FIFO
substituted before open. No walking, shell commands, helper process, network
scan, OS clipboard read, or persistent content journal is used. File-system IO
on an explicitly selected slow/network file can still block in the OS; metadata
checks are best-effort race detection, not an atomic two-file snapshot.

Acceptance limits are 256 KiB/file, 384 KiB combined raw bytes, 20000 lines/file,
30000 lines combined, 1000000 graph/comparison work units (including conservative
compared-byte charges), and 2 MiB raw diff output. The Myers frontier and component
arena are bounded by those limits; there is no unbounded N×M matrix. Exceeding a
limit returns an actionable error without a truncated successful result. NUL,
DEL and ASCII controls except TAB/CR/LF are explicitly rejected because the
native HTML surface cannot faithfully display them. Other Unicode is preserved.
A missing/inaccessible/directory/changed file reports its selected side and an
error category; arbitrary host exception paths are not echoed.

Build with an already installed Rust toolchain:

```sh
cargo +stable build --locked --release --manifest-path v2/Cargo.toml
python3 v2/scripts/validate.py
```

The validation runner confines HOME, TMP, caches, profiles and fixture files to
ignored `v2/.qa`; it does not inspect real selection or clipboard. It uses npm
only for disposable V1/oracle/renderer QA, never as product runtime. See
[QA.md](QA.md), [INTEGRATION.md](INTEGRATION.md), and [evidence](evidence/).
The ZIP builder is development-only; `artifacts:{}` deliberately contains no
fabricated URL or release pins. No installer or live app has been run.

Pins:

- Own origin/main and unchanged HEAD: `12e6a2f422647b98274e3bfd63c814ed073820f2`.
- Host read with `git show` only: `ea100cee3f69711de12485ba061950c5fc65258f`.
- SDK 0.1.1, HTTPS Git: `e955911f0bf5b558f9d3eb5183df0adc95c22af2`.
- Raycast provenance: `6734d85992290066fd31a7f5bee3cca3d3545a1a`.
- Original PNG SHA256: `539f182de0e5c528161361fb6f949fda52800f025a947cd3421512064aafddd5`.

Licenses and notices are authentic supplied bytes. The source LICENSE's literal
backslash-newline notation is retained. `r-efi`'s crate omits full license texts;
its README/AUTHORS evidence and the missing-text flag are explicit. It is a dormant
UEFI lockfile branch, not compiled for the declared targets. See [NOTICE](NOTICE).
