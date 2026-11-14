use crate::storage::{atomic_write, is_source_file, Store};
use base64::{engine::general_purpose::STANDARD, Engine};
use tauri::Manager;
use tauri_plugin_clipboard_manager::ClipboardExt;
pub(crate) fn export_bytes(format: &str, data: String) -> Result<(&'static str, Vec<u8>), String> {
    if format == "xmind" {
        return crate::storage::decode_archive(&data)
            .map(|bytes| ("xmind", bytes))
            .map_err(|error| error.replace("minimap", "XMind"));
    }
    if data.len() > 90 * 1024 * 1024 {
        return Err("Export exceeds the size limit".into());
    }
    let (extension, bytes) = match format {
        "svg" if data.starts_with("<svg ") => ("svg", data.into_bytes()),
        "md" => ("md", data.into_bytes()),
        "png" => {
            let bytes = STANDARD.decode(data).map_err(|_| "Invalid PNG data")?;
            if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
                return Err("Invalid PNG data".into());
            }
            ("png", bytes)
        }
        _ => return Err("Unsupported export format".into()),
    };
    if bytes.len() > 64 * 1024 * 1024 {
        return Err("Export exceeds 64 MB".into());
    }
    Ok((extension, bytes))
}

#[tauri::command]
pub(crate) async fn copy_png(app: tauri::AppHandle, data: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let image = clipboard_image(data)?;
        app.clipboard()
            .write_image(&image)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

fn clipboard_image(data: String) -> Result<tauri::image::Image<'static>, String> {
    let (_, bytes) = export_bytes("png", data)?;
    tauri::image::Image::from_bytes(&bytes).map_err(|error| format!("Invalid PNG data: {error}"))
}

#[tauri::command]
pub(crate) async fn export_file(
    app: tauri::AppHandle,
    format: String,
    data: String,
) -> Result<bool, String> {
    let (extension, bytes) = export_bytes(&format, data)?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = rfd::FileDialog::new()
            .add_filter(
                match extension {
                    "md" => "Markdown",
                    "xmind" => "XMind",
                    _ => "Images",
                },
                &[extension],
            )
            .set_file_name(format!("mindmap.{extension}"))
            .save_file()
        else {
            return Ok(false);
        };
        if path
            .extension()
            .and_then(|v| v.to_str())
            .is_none_or(|v| !v.eq_ignore_ascii_case(extension))
        {
            return Err(format!("File extension must be .{extension}"));
        }
        let store = app.state::<Store>();
        let state = store.0.lock().map_err(|_| "File state is unavailable")?;
        if is_source_file(&path, state.path.as_deref()) {
            return Err("Cannot overwrite the current map file".into());
        }
        if let Some(warning) = atomic_write(&path, &bytes)? {
            return Err(warning);
        }
        Ok(true)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) fn open_link(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://"))
        || url.chars().any(char::is_control)
    {
        return Err("Only HTTP or HTTPS links are supported".into());
    }
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = std::process::Command::new("rundll32.exe");
        command.arg("url.dll,FileProtocolHandler");
        command
    };
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let mut command = std::process::Command::new("xdg-open");
    command
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Could not open link: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_unsafe_links() {
        assert!(open_link("file:///tmp/example".into()).is_err());
        assert!(open_link("https://example.com/\ninvalid".into()).is_err());
    }

    #[test]
    fn validates_export_format_and_png_signature() {
        assert!(export_bytes("svg", "<svg xmlns=\"http://www.w3.org/2000/svg\"/>".into()).is_ok());
        assert!(export_bytes("png", STANDARD.encode(b"\x89PNG\r\n\x1a\nrest")).is_ok());
        assert!(export_bytes("png", STANDARD.encode(b"not a png")).is_err());
        assert!(export_bytes("md", "# 中文\n".into()).is_ok());
        assert!(export_bytes("json", "{}".into()).is_err());
        let archive = include_bytes!("../../tests/fixtures/reference.minimap");
        assert_eq!(
            export_bytes("xmind", STANDARD.encode(archive)).unwrap(),
            ("xmind", archive.to_vec())
        );
        assert!(export_bytes("xmind", STANDARD.encode(b"not a zip")).is_err());
        assert!(export_bytes("xmind", "invalid base64".into()).is_err());
    }

    #[test]
    fn clipboard_requires_a_decodable_png() {
        let png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==";
        let image = clipboard_image(png.into()).unwrap();
        assert_eq!((image.width(), image.height()), (1, 1));
        assert!(clipboard_image(STANDARD.encode(b"\x89PNG\r\n\x1a\ninvalid")).is_err());
    }
}
