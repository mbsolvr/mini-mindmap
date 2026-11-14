use crate::storage::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::{
    hash::{DefaultHasher, Hash, Hasher},
    path::PathBuf,
};
use tauri::Manager;
#[derive(Serialize)]
pub(crate) struct OpenedFile {
    name: String,
    contents: String,
}

#[derive(Serialize)]
pub(crate) struct SaveResult {
    path: String,
    warning: Option<String>,
}

fn archive_hash(contents: &[u8]) -> u64 {
    let mut hasher = DefaultHasher::new();
    contents.hash(&mut hasher);
    hasher.finish()
}

fn prepare_open(path: PathBuf, store: &Store) -> Result<OpenedFile, String> {
    let contents = read_archive(&path)?;
    if !contents.starts_with(b"PK\x03\x04") {
        return Err("Invalid or unsupported minimap file".into());
    }
    store
        .0
        .lock()
        .map_err(|_| "File state is unavailable")?
        .pending = Some((path.clone(), archive_hash(&contents)));
    Ok(OpenedFile {
        name: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        contents: STANDARD.encode(contents),
    })
}

#[tauri::command]
pub(crate) async fn open_copy(app: tauri::AppHandle) -> Result<Option<OpenedFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = rfd::FileDialog::new()
            .add_filter("Mini Mindmap", &["minimap"])
            .pick_file()
        else {
            return Ok(None);
        };
        prepare_open(path, &app.state::<Store>()).map(Some)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn import_xmind() -> Result<Option<OpenedFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = rfd::FileDialog::new()
            .add_filter("XMind", &["xmind"])
            .pick_file()
        else {
            return Ok(None);
        };
        let contents = read_archive(&path)?;
        if !contents.starts_with(b"PK\x03\x04") {
            return Err("Invalid or unsupported XMind file".into());
        }
        Ok(Some(OpenedFile {
            name: path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            contents: STANDARD.encode(contents),
        }))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn open_launched(
    app: tauri::AppHandle,
) -> Result<Option<Result<OpenedFile, String>>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let queue = app.state::<crate::launch::LaunchFiles>();
        let path = queue
            .0
            .lock()
            .map_err(|_| "File queue is unavailable")?
            .pop_front();
        Ok(path.map(|path| prepare_open(path, &app.state::<Store>())))
    })
    .await
    .map_err(|error| error.to_string())?
}

fn accept_pending(store: &Store) -> Result<String, String> {
    let mut state = store.0.lock().map_err(|_| "File state is unavailable")?;
    let (path, expected) = state
        .pending
        .take()
        .ok_or("No file is waiting to be opened")?;
    let contents = read_archive(&path)?;
    if archive_hash(&contents) != expected {
        return Err("The file changed while opening; open it again".into());
    }
    state.saved = contents;
    state.path = Some(path.clone());
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub(crate) async fn accept_open(app: tauri::AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || accept_pending(&app.state::<Store>()))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) fn clear_target(store: tauri::State<'_, Store>) -> Result<(), String> {
    *store.0.lock().map_err(|_| "File state is unavailable")? = FileState::default();
    Ok(())
}

#[tauri::command]
pub(crate) async fn save_as(
    app: tauri::AppHandle,
    contents: String,
) -> Result<Option<SaveResult>, String> {
    let bytes = decode_archive(&contents)?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = rfd::FileDialog::new()
            .add_filter("Mini Mindmap", &["minimap"])
            .set_file_name("mini-mindmap.minimap")
            .save_file()
        else {
            return Ok(None);
        };
        if path
            .extension()
            .and_then(|v| v.to_str())
            .is_none_or(|v| !v.eq_ignore_ascii_case("minimap"))
        {
            return Err("File extension must be .minimap".into());
        }
        let store = app.state::<Store>();
        let mut state = store.0.lock().map_err(|_| "File state is unavailable")?;
        if is_source_file(&path, state.path.as_deref()) {
            let warning = write_existing(&mut state, &contents)?;
            return Ok(Some(SaveResult {
                path: path.to_string_lossy().into_owned(),
                warning,
            }));
        }
        let warning = atomic_write(&path, &bytes)?;
        state.saved = bytes;
        state.path = Some(path.clone());
        Ok(Some(SaveResult {
            path: path.to_string_lossy().into_owned(),
            warning,
        }))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn save_current(
    app: tauri::AppHandle,
    contents: String,
) -> Result<SaveResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<Store>();
        let mut state = store.0.lock().map_err(|_| "File state is unavailable")?;
        let warning = write_existing(&mut state, &contents)?;
        Ok(SaveResult {
            path: state
                .path
                .as_ref()
                .ok_or("Choose a save location first")?
                .to_string_lossy()
                .into_owned(),
            warning,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::temp_dir;
    use std::fs;

    #[test]
    fn opening_stages_only_valid_archive_bytes() {
        let dir = temp_dir();
        let path = dir.join("中文 map.minimap");
        let bytes = include_bytes!("../../tests/fixtures/reference.minimap");
        fs::write(&path, bytes).unwrap();
        let store = Store::default();
        let opened = prepare_open(path.clone(), &store).unwrap();
        assert_eq!(opened.name, "中文 map.minimap");
        assert_eq!(STANDARD.decode(&opened.contents).unwrap(), bytes);
        assert_eq!(
            serde_json::to_value(Some(Ok::<_, String>(opened))).unwrap()["Ok"]["name"],
            "中文 map.minimap"
        );
        assert_eq!(
            store.0.lock().unwrap().pending.as_ref().unwrap(),
            &(path.clone(), archive_hash(bytes))
        );
        fs::write(&path, b"invalid").unwrap();
        assert!(prepare_open(path.clone(), &store).is_err());
        assert_eq!(
            store.0.lock().unwrap().pending.as_ref().unwrap(),
            &(path, archive_hash(bytes))
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn accepting_open_establishes_the_reread_bytes_as_the_save_baseline() {
        let dir = temp_dir();
        let path = dir.join("map.minimap");
        let bytes = include_bytes!("../../tests/fixtures/reference.minimap");
        fs::write(&path, bytes).unwrap();
        let store = Store::default();
        prepare_open(path.clone(), &store).unwrap();
        assert_eq!(accept_pending(&store).unwrap(), path.to_string_lossy());
        let state = store.0.lock().unwrap();
        assert_eq!(state.path.as_ref(), Some(&path));
        assert_eq!(state.saved, bytes);
        assert!(state.pending.is_none());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_changed_or_deleted_pending_file_preserves_the_current_save_target() {
        for deleted in [false, true] {
            let dir = temp_dir();
            let path = dir.join("next.minimap");
            let previous = dir.join("current.minimap");
            let bytes = include_bytes!("../../tests/fixtures/reference.minimap");
            fs::write(&path, bytes).unwrap();
            let store = Store(std::sync::Mutex::new(FileState {
                path: Some(previous.clone()),
                saved: bytes.to_vec(),
                ..Default::default()
            }));
            prepare_open(path.clone(), &store).unwrap();
            if deleted {
                fs::remove_file(&path).unwrap();
            } else {
                fs::write(&path, b"external edit").unwrap();
            }
            assert!(accept_pending(&store).is_err());
            let state = store.0.lock().unwrap();
            assert_eq!(state.path.as_ref(), Some(&previous));
            assert_eq!(state.saved, bytes);
            fs::remove_dir_all(dir).unwrap();
        }
    }
}
