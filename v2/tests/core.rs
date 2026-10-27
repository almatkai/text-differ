use text_differ_v2::core::{compare, diff_lines, escaped_pre, read_selected, MAX_FILE_BYTES};

#[tokio::test]
async fn grouping_and_tie_match_locked_jsdiff() {
    let changes = diff_lines("a\nb\n", "b\na\n").await.unwrap();
    assert_eq!(
        changes
            .iter()
            .map(|c| (c.count, c.added, c.removed, c.value.as_str()))
            .collect::<Vec<_>>(),
        vec![
            (1, false, true, "a\n"),
            (1, false, false, "b\n"),
            (1, true, false, "a\n")
        ]
    );
    assert_eq!(
        compare(b"a\nb\n", b"c\nd\n").await.unwrap(),
        "-a\nb\n+c\nd\n"
    );
    assert_eq!(compare(b"", b"").await.unwrap(), "");
    assert_eq!(compare(b"a\r\n", b"a\n").await.unwrap(), "-a\r\n+a\n");
}
#[tokio::test]
async fn bytes_decoding_controls_and_explicit_limits() {
    assert_eq!(compare(&[0xe2, 0x82], "�".as_bytes()).await.unwrap(), " �");
    assert_eq!(
        compare("\u{feff}x".as_bytes(), b"x").await.unwrap(),
        "-\u{feff}x+x"
    );
    assert!(compare(&[0], b"").await.unwrap_err().contains("control"));
    assert!(compare(&vec![b'a'; MAX_FILE_BYTES + 1], b"").await.is_err());
    assert!(compare("a\n".repeat(20_001).as_bytes(), b"")
        .await
        .unwrap_err()
        .contains("Line limit"));
    assert!(
        compare("a\n".repeat(4000).as_bytes(), "b\n".repeat(4000).as_bytes())
            .await
            .unwrap_err()
            .contains("work limit")
    );
}
#[test]
fn hostile_text_stays_inert() {
    let escaped = escaped_pre("<img src=x>&`\r\"'");
    assert!(escaped.ends_with("<pre>&lt;img src=x&gt;&amp;`\\r&quot;&#39;</pre>"));
    assert!(escaped.contains("Display escapes"));
}
#[tokio::test]
async fn owned_regular_file_and_symlink_handles() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(".qa/unit");
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("read.txt");
    std::fs::write(&file, b"owned fixture\n").unwrap();
    assert_eq!(
        read_selected(file.to_str().unwrap()).await.unwrap(),
        b"owned fixture\n"
    );
    assert!(read_selected(dir.to_str().unwrap()).await.is_err());
    assert!(read_selected("relative.txt").await.is_err());
    #[cfg(unix)]
    {
        let link = dir.join("link.txt");
        let _ = std::fs::remove_file(&link);
        std::os::unix::fs::symlink(&file, &link).unwrap();
        assert_eq!(
            read_selected(link.to_str().unwrap()).await.unwrap(),
            b"owned fixture\n"
        );
        let fifo = dir.join("pipe");
        let _ = std::fs::remove_file(&fifo);
        use std::os::unix::ffi::OsStrExt;
        let raw = std::ffi::CString::new(fifo.as_os_str().as_bytes()).unwrap();
        // SAFETY: raw is a valid owned CString, mode is a standard permission mask.
        assert_eq!(unsafe { libc::mkfifo(raw.as_ptr(), 0o600) }, 0);
        assert!(read_selected(fifo.to_str().unwrap()).await.is_err());
    }
}

#[tokio::test]
async fn concurrent_changes_are_rejected_instead_of_partial_success() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(".qa/unit");
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("changing.txt");
    std::fs::write(&file, vec![b'a'; MAX_FILE_BYTES]).unwrap();
    let read = read_selected(file.to_str().unwrap());
    let change = async {
        std::fs::write(&file, b"changed").unwrap();
    };
    let (read, ()) = tokio::join!(read, change);
    assert!(read.unwrap_err().contains("changed while reading"));
}
