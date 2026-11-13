#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

mod commands;
mod desktop;
mod instance;
mod launch;
mod recovery;
mod storage;
#[cfg(test)]
mod test_support;

use tauri::Manager;

fn main() {
    std::env::set_var("GTK_USE_PORTAL", "1");
    let paths = launch::paths_from_args(
        std::env::args_os(),
        &std::env::current_dir().unwrap_or_default(),
    );
    let builder =
        tauri::Builder::default().manage(launch::LaunchFiles(std::sync::Mutex::new(paths)));
    #[cfg(target_os = "windows")]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
        use tauri::Emitter;
        let paths =
            launch::paths_from_args(args.into_iter().map(Into::into), std::path::Path::new(&cwd));
        if !paths.is_empty() {
            if let Ok(mut queue) = app.state::<launch::LaunchFiles>().0.lock() {
                queue.extend(paths);
                let _ = app.emit("launch-file", ());
            }
        }
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }));
    builder
        .setup(|app| {
            let lock = instance::instance_lock(app.handle()).map_err(std::io::Error::other)?;
            app.manage(lock);
            Ok(())
        })
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(storage::Store::default())
        .invoke_handler(tauri::generate_handler![
            desktop::export_file,
            desktop::copy_png,
            desktop::open_link,
            commands::open_copy,
            commands::open_launched,
            commands::accept_open,
            commands::save_as,
            commands::save_current,
            recovery::read_recovery,
            recovery::write_recovery,
            recovery::clear_recovery
        ])
        .run(tauri::generate_context!())
        .expect("Could not start Mini Mindmap");
}
