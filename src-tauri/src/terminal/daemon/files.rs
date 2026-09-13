use super::{
    super::{
        AppError,
        overlay::{LaunchFile, LaunchOverlay},
    },
    protocol::{WireFile, WireOverlay},
};
use std::path::Path;

pub fn encode(overlay: &LaunchOverlay) -> Result<WireOverlay, AppError> {
    let mut files = vec![];
    for file in &overlay.retained_files {
        let contents = std::fs::read_to_string(file.path())
            .map_err(|error| AppError::io(error.to_string()))?;
        files.push(WireFile {
            original: file.path().to_string_lossy().into_owned(),
            contents,
        });
    }
    Ok(WireOverlay {
        arguments: overlay.arguments.clone(),
        environment: overlay.environment.clone(),
        unset: overlay.unset.clone(),
        files,
    })
}

pub fn decode(wire: WireOverlay, root: &Path) -> Result<LaunchOverlay, AppError> {
    if wire.files.len() > 8
        || wire
            .files
            .iter()
            .any(|file| file.contents.len() > 1024 * 1024 || file.original.is_empty())
    {
        return Err(AppError::invalid_argument("后台启动快照超过限制"));
    }
    let mut overlay = LaunchOverlay {
        arguments: wire.arguments,
        environment: wire.environment,
        unset: wire.unset,
        ..Default::default()
    };
    for file in wire.files {
        let retained = LaunchFile::create(root, &file.contents)?;
        let path = retained.path().to_string_lossy().into_owned();
        for arg in &mut overlay.arguments {
            *arg = arg.replace(&file.original, &path);
        }
        for value in overlay.environment.values_mut() {
            *value = value.replace(&file.original, &path);
        }
        overlay.retained_files.push(retained);
    }
    Ok(overlay)
}
