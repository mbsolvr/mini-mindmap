use crate::storage::atomic_write;
use std::{fs, path::PathBuf};
use tauri::Manager;
pub(crate) fn recovery_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| format!("Could not access recovery data: {error}"))?;
    Ok(dir.join("recovery.json"))
}

#[tauri::command]
pub(crate) async fn read_recovery(app: tauri::AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || match fs::read_to_string(recovery_path(&app)?) {
        Ok(data) => Ok(Some(data)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Could not read recovery data: {error}")),
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn write_recovery(app: tauri::AppHandle, contents: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        atomic_write(&recovery_path(&app)?, contents.as_bytes())
            .and_then(|warning| warning.map_or(Ok(()), Err))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn clear_recovery(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = recovery_path(&app)?;
        match fs::remove_file(&path) {
            Ok(()) => {
                #[cfg(unix)]
                fs::File::open(path.parent().unwrap())
                    .and_then(|file| file.sync_all())
                    .map_err(|error| error.to_string())?;
                Ok(())
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!("Could not remove recovery data: {error}")),
        }
    })
    .await
    .map_err(|error| error.to_string())?
}
