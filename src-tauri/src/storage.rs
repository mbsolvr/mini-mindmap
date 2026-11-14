use base64::{engine::general_purpose::STANDARD, Engine};
use std::{
    fs,
    path::{Path, PathBuf},
};
use std::{
    fs::OpenOptions,
    io::{Read, Write},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};
static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);
pub(crate) const MAX_ARCHIVE_BYTES: u64 = 256 * 1024 * 1024;
const ARCHIVE_TOO_LARGE: &str = "Map file exceeds 256 MB";

#[derive(Default)]
pub(crate) struct FileState {
    pub(crate) path: Option<PathBuf>,
    pub(crate) saved: Vec<u8>,
    pub(crate) pending: Option<(PathBuf, u64)>,
}
#[derive(Default)]
pub(crate) struct Store(pub(crate) Mutex<FileState>);
pub(crate) fn decode_archive(contents: &str) -> Result<Vec<u8>, String> {
    if contents.len() > (MAX_ARCHIVE_BYTES as usize).div_ceil(3) * 4 {
        return Err(ARCHIVE_TOO_LARGE.into());
    }
    let bytes = STANDARD
        .decode(contents)
        .map_err(|_| "Invalid or unsupported minimap file")?;
    if bytes.len() as u64 > MAX_ARCHIVE_BYTES {
        return Err(ARCHIVE_TOO_LARGE.into());
    }
    if !bytes.starts_with(b"PK\x03\x04") {
        return Err("Invalid or unsupported minimap file".into());
    }
    Ok(bytes)
}

pub(crate) fn read_archive(path: &Path) -> Result<Vec<u8>, String> {
    let file = fs::File::open(path).map_err(|error| format!("Could not read file: {error}"))?;
    if file
        .metadata()
        .map_err(|error| format!("Could not read file: {error}"))?
        .len()
        > MAX_ARCHIVE_BYTES
    {
        return Err(ARCHIVE_TOO_LARGE.into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_ARCHIVE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Could not read file: {error}"))?;
    if bytes.len() as u64 > MAX_ARCHIVE_BYTES {
        return Err(ARCHIVE_TOO_LARGE.into());
    }
    Ok(bytes)
}

pub(crate) fn atomic_write(path: &Path, bytes: &[u8]) -> Result<Option<String>, String> {
    atomic_write_checked(path, bytes, None)
}

fn atomic_write_checked(
    path: &Path,
    bytes: &[u8],
    expected: Option<&[u8]>,
) -> Result<Option<String>, String> {
    #[cfg(unix)]
    let directory = fs::File::open(path.parent().ok_or("Invalid file location")?)
        .map_err(|error| format!("Could not open save directory: {error}"))?;
    atomic_write_with_sync(path, bytes, expected, || {
        #[cfg(unix)]
        directory.sync_all()?;
        Ok(())
    })
}

fn atomic_write_with_sync(
    path: &Path,
    bytes: &[u8],
    expected: Option<&[u8]>,
    sync_directory: impl FnOnce() -> std::io::Result<()>,
) -> Result<Option<String>, String> {
    let parent = path.parent().ok_or("Invalid file location")?;
    if fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err("Cannot overwrite a symbolic link; choose a regular file".into());
    }
    let metadata = fs::metadata(path).ok();
    if metadata.as_ref().is_some_and(|m| !m.is_file()) {
        return Err("The target is not a regular file".into());
    }
    let mut last_error = None;
    for _ in 0..10 {
        let serial = NEXT_TEMP.fetch_add(1, Ordering::Relaxed);
        let temp = parent.join(format!(".mini-mindmap-{}-{serial}.tmp", std::process::id()));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = match options.open(&temp) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                last_error = Some(error);
                continue;
            }
            Err(error) => return Err(format!("Could not create temporary file: {error}")),
        };
        // Sync a temporary file before replacement so interruption cannot leave a partial map.
        let result = (|| -> std::io::Result<()> {
            if let Some(metadata) = metadata {
                file.set_permissions(metadata.permissions())?;
            }
            file.write_all(bytes)?;
            file.sync_all()?;
            if let Some(expected) = expected {
                if fs::read(path)? != expected {
                    return Err(std::io::Error::other("The file changed outside the app; auto-save is paused. Save as a new file."));
                }
            }
            // shortcut: uncooperative writers can still change the file before rename; use coordinated locking if needed.
            fs::rename(&temp, path)?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temp);
        }
        result.map_err(|error| format!("Could not save file: {error}"))?;
        return Ok(sync_directory().err().map(|error| format!("File replaced, but directory synchronization failed; durability is not confirmed: {error}")));
    }
    Err(format!(
        "Could not create temporary file: {}",
        last_error.unwrap()
    ))
}

pub(crate) fn is_source_file(path: &Path, source: Option<&Path>) -> bool {
    source.is_some_and(|original| {
        path.exists() && fs::canonicalize(original).ok() == fs::canonicalize(path).ok()
    })
}

pub(crate) fn write_existing(
    state: &mut FileState,
    contents: &str,
) -> Result<Option<String>, String> {
    write_existing_with(state, contents, |path, bytes, expected| {
        atomic_write_checked(path, bytes, Some(expected))
    })
}

fn write_existing_with(
    state: &mut FileState,
    contents: &str,
    write: impl FnOnce(&Path, &[u8], &[u8]) -> Result<Option<String>, String>,
) -> Result<Option<String>, String> {
    let bytes = decode_archive(contents)?;
    let path = state.path.as_ref().ok_or("Choose a save location first")?;
    let current = read_archive(path)?;
    if current != state.saved {
        return Err(
            "The file changed outside the app; auto-save is paused. Save as a new file.".into(),
        );
    }
    let warning = write(path, &bytes, &state.saved)?;
    // Keep the new baseline even if directory sync reports a durability warning.
    state.saved = bytes;
    Ok(warning)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::temp_dir;
    #[test]
    fn oversized_file_is_rejected_before_reading() {
        let dir = temp_dir();
        let path = dir.join("large.minimap");
        fs::File::create(&path)
            .unwrap()
            .set_len(MAX_ARCHIVE_BYTES + 1)
            .unwrap();
        assert!(read_archive(&path).unwrap_err().contains("256 MB"));
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn rejects_invalid_archive_data() {
        assert!(decode_archive(&STANDARD.encode(b"PK\x03\x04data")).is_ok());
        assert!(decode_archive(&STANDARD.encode(b"not a zip")).is_err());
        assert!(decode_archive("bad base64").is_err());
    }
    #[test]
    fn save_detects_external_changes_and_preserves_them() {
        let dir = temp_dir();
        let path = dir.join("map.json");
        let old = b"PK\x03\x04old";
        let changed = b"PK\x03\x04new";
        atomic_write(&path, old).unwrap();
        let mut state = FileState {
            path: Some(path.clone()),
            saved: old.to_vec(),
            pending: None,
        };
        write_existing(&mut state, &STANDARD.encode(changed)).unwrap();
        assert_eq!(fs::read(&path).unwrap(), changed);
        fs::write(&path, "external").unwrap();
        assert!(write_existing(&mut state, &STANDARD.encode(old)).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "external");
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn changed_file_is_preserved_before_replacement() {
        let dir = temp_dir();
        let path = dir.join("map.minimap");
        let old = b"PK\x03\x04old";
        fs::write(&path, old).unwrap();
        let mut state = FileState {
            path: Some(path.clone()),
            saved: old.to_vec(),
            ..Default::default()
        };
        let result = write_existing_with(
            &mut state,
            &STANDARD.encode(b"PK\x03\x04new"),
            |path, bytes, expected| {
                fs::write(path, b"external").unwrap();
                atomic_write_checked(path, bytes, Some(expected))
            },
        );
        assert!(result.is_err());
        assert_eq!(fs::read(&path).unwrap(), b"external");
        assert_eq!(state.saved, old);
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn invalid_data_does_not_overwrite_the_file() {
        let dir = temp_dir();
        let path = dir.join("map.json");
        let old = b"PK\x03\x04old";
        fs::write(&path, old).unwrap();
        let mut state = FileState {
            path: Some(path.clone()),
            saved: old.to_vec(),
            pending: None,
        };
        assert!(write_existing(&mut state, "{").is_err());
        assert_eq!(fs::read(&path).unwrap(), old);
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn directory_sync_failure_preserves_baseline_and_allows_retry() {
        let dir = temp_dir();
        let path = dir.join("map.minimap");
        let old = b"PK\x03\x04old";
        let changed = b"PK\x03\x04new";
        atomic_write(&path, old).unwrap();
        let mut state = FileState {
            path: Some(path.clone()),
            saved: old.to_vec(),
            ..Default::default()
        };
        let warning = write_existing_with(
            &mut state,
            &STANDARD.encode(changed),
            |path, bytes, expected| {
                atomic_write_with_sync(path, bytes, Some(expected), || {
                    Err(std::io::Error::other("simulated directory sync failure"))
                })
            },
        )
        .unwrap();
        assert!(warning.unwrap().contains("durability is not confirmed"));
        assert_eq!(fs::read(&path).unwrap(), changed);
        assert_eq!(state.saved, changed);
        assert!(write_existing(&mut state, &STANDARD.encode(changed))
            .unwrap()
            .is_none());
        fs::write(&path, b"external").unwrap();
        assert!(write_existing(&mut state, &STANDARD.encode(old)).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"external");
        fs::remove_dir_all(dir).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn unreadable_directory_is_rejected_before_replacement() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir();
        let path = dir.join("map.minimap");
        fs::write(&path, b"old").unwrap();
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o300)).unwrap();
        if fs::File::open(&dir).is_err() {
            assert!(atomic_write(&path, b"new").is_err());
            assert_eq!(fs::read(&path).unwrap(), b"old");
        }
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn real_map_file_round_trips_and_external_change_is_preserved() {
        let dir = temp_dir();
        let path = dir.join("map.minimap");
        let fixture = include_bytes!("../../tests/fixtures/reference.minimap");
        atomic_write(&path, fixture).unwrap();
        let mut state = FileState {
            path: Some(path.clone()),
            saved: read_archive(&path).unwrap(),
            ..Default::default()
        };
        write_existing(&mut state, &STANDARD.encode(fixture)).unwrap();
        assert_eq!(read_archive(&path).unwrap(), fixture);
        fs::write(&path, b"external change").unwrap();
        assert!(write_existing(&mut state, &STANDARD.encode(fixture)).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"external change");
        fs::remove_dir_all(dir).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn atomic_write_crash_child() {
        let Some(dir) = std::env::var_os("MINIMAP_CRASH_TEST_DIR") else {
            return;
        };
        let dir = PathBuf::from(dir);
        let path = dir.join("map.minimap");
        let first = vec![b'A'; 1024 * 1024];
        let second = vec![b'B'; 1024 * 1024];
        atomic_write(&path, &first).unwrap();
        fs::write(dir.join("ready"), b"ready").unwrap();
        loop {
            atomic_write(&path, &second).unwrap();
            atomic_write(&path, &first).unwrap();
        }
    }
    #[cfg(unix)]
    #[test]
    fn interrupted_atomic_write_keeps_a_complete_file() {
        let dir = temp_dir();
        let mut child = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "storage::tests::atomic_write_crash_child",
                "--nocapture",
            ])
            .env("MINIMAP_CRASH_TEST_DIR", &dir)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while !dir.join("ready").exists() && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        if !dir.join("ready").exists() {
            let _ = child.kill();
            let _ = child.wait();
            panic!("crash test child did not start");
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
        child.kill().unwrap();
        child.wait().unwrap();
        let bytes = fs::read(dir.join("map.minimap")).unwrap();
        assert_eq!(bytes.len(), 1024 * 1024);
        assert!(bytes.iter().all(|byte| *byte == b'A') || bytes.iter().all(|byte| *byte == b'B'));
        fs::remove_dir_all(dir).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn source_and_symbolic_links_are_not_overwritten() {
        use std::os::unix::fs::symlink;
        let dir = temp_dir();
        let original = dir.join("original.json");
        let link = dir.join("alias.json");
        fs::write(&original, "original").unwrap();
        symlink(&original, &link).unwrap();
        assert!(is_source_file(&link, Some(&original)));
        assert!(atomic_write(&link, b"new").is_err());
        assert_eq!(fs::read_to_string(&original).unwrap(), "original");
        assert!(fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink());
        fs::remove_dir_all(dir).unwrap();
    }
}
