use std::{
    collections::VecDeque,
    ffi::OsString,
    path::{Path, PathBuf},
    sync::Mutex,
};

pub(crate) struct LaunchFiles(pub(crate) Mutex<VecDeque<PathBuf>>);

pub(crate) fn paths_from_args(
    args: impl IntoIterator<Item = OsString>,
    cwd: &Path,
) -> VecDeque<PathBuf> {
    args.into_iter()
        .skip(1)
        .map(PathBuf::from)
        .filter(|path| {
            path.extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| ext.eq_ignore_ascii_case("minimap"))
        })
        .map(|path| cwd.join(path))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_minimap_arguments_and_resolves_relative_paths() {
        let cwd = std::env::current_dir().unwrap();
        let absolute = cwd.join("other/file.minimap");
        let args = vec![
            "app.exe".into(),
            "--option".into(),
            "中文 map.MINIMAP".into(),
            absolute.clone().into_os_string(),
            "ignored.zip".into(),
        ];
        let paths = paths_from_args(args, &cwd);
        assert_eq!(
            paths,
            VecDeque::from([cwd.join("中文 map.MINIMAP"), absolute])
        );
    }
}
