use std::time::{SystemTime, UNIX_EPOCH};
use std::{fs, path::PathBuf};
pub(crate) fn temp_dir() -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "mini-mindmap-test-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir(&path).unwrap();
    path
}
