use std::{
    fs::{self, OpenOptions},
    path::{Path, PathBuf},
};
pub(crate) fn lock_file(path: &Path) -> Result<fs::File, String> {
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)
        .map_err(|error| error.to_string())?;
    file.try_lock()
        .map_err(|_| "Mini Mindmap is already running or the application lock is unavailable")?;
    Ok(file)
}

pub(crate) fn instance_lock(app: &tauri::AppHandle) -> Result<(fs::File, fs::File), String> {
    let dir = std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("XDG_DATA_HOME").map(PathBuf::from))
        .or_else(|| std::env::var_os("LOCALAPPDATA").map(PathBuf::from))
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share")))
        .ok_or("Cannot find a per-user directory for the application lock")?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    lock_both(
        &dir.join("mini-mindmap.lock"),
        &crate::recovery::recovery_path(app)?,
    )
}

fn lock_both(legacy: &Path, recovery: &Path) -> Result<(fs::File, fs::File), String> {
    Ok((
        lock_file(legacy)?,
        lock_file(&recovery.with_file_name("instance.lock"))?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::temp_dir;
    #[test]
    fn instance_lock_is_released_when_owner_exits() {
        let dir = temp_dir();
        let legacy = dir.join("mini-mindmap.lock");
        let path = dir.join("recovery.json");
        let first = lock_both(&legacy, &path).unwrap();
        assert!(lock_file(&legacy).is_err());
        assert!(lock_file(&dir.join("instance.lock")).is_err());
        assert!(lock_both(&legacy, &path).is_err());
        drop(first);
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(1);
        loop {
            if lock_both(&legacy, &path).is_ok() {
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "lock was not released"
            );
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        let existing = lock_file(&dir.join("instance.lock")).unwrap();
        assert!(lock_both(&legacy, &path).is_err());
        assert!(lock_file(&legacy).is_ok());
        drop(existing);
        let old_app = lock_file(&legacy).unwrap();
        assert!(lock_both(&legacy, &path).is_err());
        drop(old_app);
        fs::remove_dir_all(dir).unwrap();
    }
}
