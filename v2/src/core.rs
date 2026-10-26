//! Default diffLines path translated from locked jsdiff 8.0.4 (BSD-3-Clause).
//! See licenses/diff-BSD-3-Clause.txt. No whitespace/newline normalization.
use std::{fs::File, io::Read, path::Path};

pub const MAX_FILE_BYTES: usize = 256 * 1024;
pub const MAX_COMBINED_BYTES: usize = 384 * 1024;
pub const MAX_LINES: usize = 20_000;
pub const MAX_COMBINED_LINES: usize = 30_000;
pub const MAX_WORK: usize = 1_000_000;
pub const MAX_OUTPUT: usize = 2 * 1024 * 1024;

pub async fn read_selected(path: &str) -> Result<Vec<u8>, String> {
    let path = Path::new(path);
    if !path.is_absolute() || path.as_os_str().len() > 32_768 {
        return Err("Select an absolute file path of at most 32768 path units.".into());
    }
    let before = std::fs::metadata(path).map_err(|e| {
        format!(
            "Cannot inspect selected file ({:?}). Select an accessible text file and retry.",
            e.kind()
        )
    })?;
    if !before.is_file() {
        return Err("The selected path is not a regular file. Select two text files.".into());
    }
    let mut options = File::options();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        // Avoid blocking on a FIFO substituted between metadata and open. Symlinks
        // to regular files remain supported. The opened handle is authoritative.
        options.custom_flags(libc::O_NONBLOCK);
    }
    let mut file = options.open(path).map_err(|e| {
        format!(
            "Cannot open selected file ({:?}). Check its permissions and retry.",
            e.kind()
        )
    })?;
    let initial = file
        .metadata()
        .map_err(|_| "Cannot inspect opened selected file.")?;
    if !initial.is_file() || initial.len() > MAX_FILE_BYTES as u64 {
        return Err("Select a regular text file no larger than 256 KiB.".into());
    }
    let mut bytes = Vec::new();
    let mut buffer = [0u8; 16 * 1024];
    loop {
        let n = file.read(&mut buffer).map_err(|e| {
            format!(
                "Cannot read selected file ({:?}). Check access and retry.",
                e.kind()
            )
        })?;
        if n == 0 {
            break;
        }
        if bytes.len() + n > MAX_FILE_BYTES {
            return Err(
                "Selected file grew past 256 KiB. Retry with a smaller stable file.".into(),
            );
        }
        bytes.extend_from_slice(&buffer[..n]);
        tokio::task::yield_now().await;
    }
    let after = file
        .metadata()
        .map_err(|_| "Cannot verify selected file after reading.")?;
    if after.len() != initial.len()
        || initial.modified().ok() != after.modified().ok()
        || after.len() != bytes.len() as u64
    {
        return Err("Selected file changed while reading. Retry when it is stable.".into());
    }
    Ok(bytes)
}

#[derive(Clone, Debug, PartialEq)]
pub struct Change {
    pub count: usize,
    pub added: bool,
    pub removed: bool,
    pub value: String,
}
#[derive(Clone, Copy)]
struct Component {
    count: usize,
    added: bool,
    removed: bool,
    previous: Option<usize>,
}
#[derive(Clone, Copy)]
struct DiffPath {
    old_pos: isize,
    last: Option<usize>,
}
fn component(
    arena: &mut Vec<Component>,
    path: DiffPath,
    added: bool,
    removed: bool,
    inc: isize,
) -> DiffPath {
    let previous = path.last.and_then(|i| {
        let last = arena[i];
        (last.added == added && last.removed == removed).then_some(last)
    });
    let next = match previous {
        Some(last) => Component {
            count: last.count + 1,
            previous: last.previous,
            added,
            removed,
        },
        None => Component {
            count: 1,
            previous: path.last,
            added,
            removed,
        },
    };
    let index = arena.len();
    arena.push(next);
    DiffPath {
        old_pos: path.old_pos + inc,
        last: Some(index),
    }
}
fn common(
    path: &mut DiffPath,
    diagonal: isize,
    old: &[&str],
    new: &[&str],
    arena: &mut Vec<Component>,
    work: &mut usize,
) -> Result<isize, String> {
    let mut new_pos = path.old_pos - diagonal;
    let mut count = 0;
    while new_pos + 1 < new.len() as isize && path.old_pos + 1 < old.len() as isize {
        *work += 1 + old[(path.old_pos + 1) as usize]
            .len()
            .min(new[(new_pos + 1) as usize].len());
        if *work > MAX_WORK {
            return Err("Diff work limit reached. Select smaller or more similar files.".into());
        }
        if old[(path.old_pos + 1) as usize] != new[(new_pos + 1) as usize] {
            break;
        }
        path.old_pos += 1;
        new_pos += 1;
        count += 1;
    }
    if count != 0 {
        let i = arena.len();
        arena.push(Component {
            count,
            added: false,
            removed: false,
            previous: path.last,
        });
        path.last = Some(i);
    }
    Ok(new_pos)
}
fn build(path: DiffPath, arena: &[Component], old: &[&str], new: &[&str]) -> Vec<Change> {
    let mut indices = Vec::new();
    let mut last = path.last;
    while let Some(i) = last {
        indices.push(i);
        last = arena[i].previous;
    }
    let (mut old_pos, mut new_pos) = (0, 0);
    indices
        .into_iter()
        .rev()
        .map(|i| {
            let c = arena[i];
            let value = if c.removed {
                let v = old[old_pos..old_pos + c.count].concat();
                old_pos += c.count;
                v
            } else {
                let v = new[new_pos..new_pos + c.count].concat();
                new_pos += c.count;
                if !c.added {
                    old_pos += c.count;
                }
                v
            };
            Change {
                count: c.count,
                added: c.added,
                removed: c.removed,
                value,
            }
        })
        .collect()
}
// Splitting at LF naturally preserves CRLF and lone CR like /(\n|\r\n)/.
fn tokenize(value: &str) -> Vec<&str> {
    value.split_inclusive('\n').collect()
}

pub async fn diff_lines(old: &str, new: &str) -> Result<Vec<Change>, String> {
    let (old, new) = (tokenize(old), tokenize(new));
    if old.len() > MAX_LINES || new.len() > MAX_LINES || old.len() + new.len() > MAX_COMBINED_LINES
    {
        return Err(
            "Line limit reached (20000 per file, 30000 combined). Select smaller files.".into(),
        );
    }
    let max = old.len() + new.len();
    let offset = max + 1;
    let mut best = vec![None; 2 * max + 3];
    let mut arena = Vec::new();
    let mut work = 0;
    let mut initial = DiffPath {
        old_pos: -1,
        last: None,
    };
    let new_pos = common(&mut initial, 0, &old, &new, &mut arena, &mut work)?;
    if initial.old_pos + 1 >= old.len() as isize && new_pos + 1 >= new.len() as isize {
        return Ok(build(initial, &arena, &old, &new));
    }
    best[offset] = Some(initial);
    let (mut min, mut max_diag) = (-(max as isize), max as isize);
    for edit in 1..=max {
        let mut diagonal = min.max(-(edit as isize));
        while diagonal <= max_diag.min(edit as isize) {
            work += 1;
            if work > MAX_WORK {
                return Err(
                    "Diff work limit reached. Select smaller or more similar files.".into(),
                );
            }
            // Reader cancellation can run between bounded blocks of graph work.
            if work % 256 == 0 {
                tokio::task::yield_now().await;
            }
            let index = (offset as isize + diagonal) as usize;
            let remove = best[index - 1].take();
            let add = best[index + 1];
            let can_add = add.is_some_and(|p| {
                let n = p.old_pos - diagonal;
                n >= 0 && n < new.len() as isize
            });
            let can_remove = remove.is_some_and(|p| p.old_pos + 1 < old.len() as isize);
            if !can_add && !can_remove {
                best[index] = None;
                diagonal += 2;
                continue;
            }
            // Exact jsdiff tie: equal oldPos chooses removal, NOT insertion.
            let mut path =
                if !can_remove || (can_add && remove.unwrap().old_pos < add.unwrap().old_pos) {
                    component(&mut arena, add.unwrap(), true, false, 0)
                } else {
                    component(&mut arena, remove.unwrap(), false, true, 1)
                };
            let n = common(&mut path, diagonal, &old, &new, &mut arena, &mut work)?;
            if path.old_pos + 1 >= old.len() as isize && n + 1 >= new.len() as isize {
                return Ok(build(path, &arena, &old, &new));
            }
            best[index] = Some(path);
            if path.old_pos + 1 >= old.len() as isize {
                max_diag = max_diag.min(diagonal - 1);
            }
            if n + 1 >= new.len() as isize {
                min = min.max(diagonal + 1);
            }
            diagonal += 2;
        }
        tokio::task::yield_now().await;
    }
    Err("Could not complete comparison within its bounds.".into())
}

pub async fn compare(left: &[u8], right: &[u8]) -> Result<String, String> {
    if left.len() > MAX_FILE_BYTES
        || right.len() > MAX_FILE_BYTES
        || left.len() + right.len() > MAX_COMBINED_BYTES
    {
        return Err(
            "Byte limit reached (256 KiB per file, 384 KiB combined). Select smaller files.".into(),
        );
    }
    // Node fs.readFile(..., 'utf8') replaces malformed sequences and keeps BOM.
    let (left, right) = (
        String::from_utf8_lossy(left),
        String::from_utf8_lossy(right),
    );
    // Keep LF, CR, TAB, and Unicode. Explicitly reject non-text ASCII controls:
    // the native/HTML transport cannot display NUL faithfully.
    if left
        .chars()
        .chain(right.chars())
        .any(|c| (c < ' ' && !matches!(c, '\n' | '\r' | '\t')) || c == '\u{7f}')
    {
        return Err("Binary/control text is unsupported (NUL, DEL or ASCII control). Select plain text files.".into());
    }
    let changes = diff_lines(&left, &right).await?;
    let size: usize = changes.iter().map(|c| 1 + c.value.len()).sum();
    if size > MAX_OUTPUT {
        return Err("Diff output limit reached. Select smaller files.".into());
    }
    let mut out = String::with_capacity(size);
    for c in changes {
        out.push(if c.added {
            '+'
        } else if c.removed {
            '-'
        } else {
            ' '
        });
        out.push_str(&c.value);
    }
    Ok(out)
}

pub fn escaped_pre(text: &str) -> String {
    // No <code>: pinned Markdown decorates pre>code with unowned copy buttons.
    let mut out = String::new();
    if text.contains(['\\', '\r']) {
        out.push_str("<p>Display escapes backslashes as \\\\ and carriage returns as \\r. Copy Diff preserves the original text.</p>\n");
    }
    out.push_str("<pre>");
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            '\r' => out.push_str("\\r"),
            '\\' => out.push_str("\\\\"),
            _ => out.push(c),
        }
    }
    out.push_str("</pre>");
    out
}
