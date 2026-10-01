//! The native folder and file pickers, titled in the page's language.
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use super::protocol::{ErrorCode, Issue};

/// Dialog text follows the page language: `lang` is "zh" or "en".
fn folder_title(kind: &str, lang: &str) -> Result<&'static str, Issue> {
    let (zh, en) = match kind {
        "game" => ("选择 KovaaK 游戏目录", "Choose the KovaaK game folder"),
        "import" => ("选择要快速导入的文件夹", "Choose a folder to import"),
        "profile-assets" => ("选择预览配置文件的目录", "Choose a folder of files to preview"),
        "export" => ("选择要保存到的文件夹", "Choose a folder to save to"),
        _ => return Err(Issue::plain(ErrorCode::InvalidPath, "folder kind must be game, import, profile-assets or export")),
    };
    pick_lang(lang, zh, en)
}

fn pick_lang(lang: &str, zh: &'static str, en: &'static str) -> Result<&'static str, Issue> {
    match lang {
        "zh" => Ok(zh),
        "en" => Ok(en),
        _ => Err(Issue::plain(ErrorCode::InvalidPath, "lang must be zh or en")),
    }
}

#[tauri::command]
pub async fn installer_pick_folder(app: AppHandle, kind: String, lang: String) -> Result<Option<String>, Issue> {
    let title = folder_title(&kind, &lang)?;
    let selected = app.dialog().file().set_title(title).blocking_pick_folder();
    selected.map(|path| path.into_path()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| Issue::plain(ErrorCode::InvalidPath, e.to_string())))
        .transpose()
}

/// Title, filter name and extensions for the single-file picker, in the page language. The
/// filter is advisory — a player can type any name — so the worker still checks the extension
/// and the content.
fn pick_file_filter(kind: &str, lang: &str) -> Result<(&'static str, &'static str, &'static [&'static str]), Issue> {
    let (title, name, extensions): ((&str, &str), (&str, &str), &'static [&'static str]) = match kind {
        "theme" => (("选择要添加的主题文件", "Choose a theme file to add"), ("主题 JSON", "Theme JSON"), &["json"]),
        "sound" => (("选择要添加的音效文件", "Choose a sound file to add"), ("音效 WAV / OGG", "Sound WAV / OGG"), &["wav", "ogg"]),
        "crosshair" => (("选择准星图片", "Choose a crosshair image"), ("PNG 图片", "PNG image"), &["png"]),
        _ => return Err(Issue::plain(ErrorCode::InvalidPath, "file kind must be theme, sound or crosshair")),
    };
    Ok((pick_lang(lang, title.0, title.1)?, pick_lang(lang, name.0, name.1)?, extensions))
}

#[tauri::command]
pub async fn installer_pick_file(app: AppHandle, kind: String, lang: String) -> Result<Option<String>, Issue> {
    let (title, name, extensions) = pick_file_filter(&kind, &lang)?;
    let selected = app.dialog().file().set_title(title).add_filter(name, extensions).blocking_pick_file();
    selected.map(|path| path.into_path()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| Issue::plain(ErrorCode::InvalidPath, e.to_string())))
        .transpose()
}

/// Title and filter for Quick import's multi-file picker: every kind it reads at once.
fn pick_files_filter(kind: &str, lang: &str) -> Result<(&'static str, &'static str, &'static [&'static str]), Issue> {
    if kind != "import" { return Err(Issue::plain(ErrorCode::InvalidPath, "files kind must be import")); }
    Ok((pick_lang(lang, "选择要快速导入的文件", "Choose files to import")?,
        pick_lang(lang, "背景、音效、准星", "Themes, sounds, crosshairs")?,
        &["json", "wav", "ogg", "png"]))
}

/// Several files at once; `None` when the player cancels. The engine reads and classifies them.
#[tauri::command]
pub async fn installer_pick_files(app: AppHandle, kind: String, lang: String) -> Result<Option<Vec<String>>, Issue> {
    let (title, name, extensions) = pick_files_filter(&kind, &lang)?;
    let Some(selected) = app.dialog().file().set_title(title).add_filter(name, extensions).blocking_pick_files() else { return Ok(None) };
    selected.into_iter().map(|path| path.into_path()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| Issue::plain(ErrorCode::InvalidPath, e.to_string())))
        .collect::<Result<Vec<_>, _>>().map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::protocol::has_cjk;

    #[test]
    fn the_file_picker_filters_by_what_is_being_added() {
        assert_eq!(pick_file_filter("theme", "zh").unwrap().2, &["json"]);
        assert_eq!(pick_file_filter("sound", "zh").unwrap().2, &["wav", "ogg"]);
        assert_eq!(pick_file_filter("crosshair", "zh").unwrap().2, &["png"]);
        assert_eq!(pick_file_filter("enemy", "zh").unwrap_err().code, ErrorCode::InvalidPath);
    }

    #[test]
    fn the_file_picker_speaks_the_page_language() {
        assert_eq!(pick_file_filter("crosshair", "zh").unwrap(), ("选择准星图片", "PNG 图片", &["png"][..]));
        assert_eq!(pick_file_filter("crosshair", "en").unwrap(), ("Choose a crosshair image", "PNG image", &["png"][..]));
        for kind in ["theme", "sound", "crosshair"] {
            let (title, name, _) = pick_file_filter(kind, "en").unwrap();
            assert!(!has_cjk(title) && !has_cjk(name), "{kind}");
        }
        assert_eq!(pick_file_filter("theme", "fr").unwrap_err().code, ErrorCode::InvalidPath);
        for kind in ["game", "import", "profile-assets", "export"] {
            assert!(has_cjk(folder_title(kind, "zh").unwrap()), "{kind}");
            assert!(!has_cjk(folder_title(kind, "en").unwrap()), "{kind}");
        }
        assert_eq!(folder_title("game", "de").unwrap_err().code, ErrorCode::InvalidPath);
        assert_eq!(folder_title("other", "en").unwrap_err().code, ErrorCode::InvalidPath);
        assert_eq!(folder_title("pack", "en").unwrap_err().code, ErrorCode::InvalidPath, "the pack folder field is gone");
        let (title, name, extensions) = pick_files_filter("import", "en").unwrap();
        assert!(!has_cjk(title) && !has_cjk(name));
        assert_eq!(extensions, &["json", "wav", "ogg", "png"]);
        assert!(has_cjk(pick_files_filter("import", "zh").unwrap().0));
        assert_eq!(pick_files_filter("theme", "en").unwrap_err().code, ErrorCode::InvalidPath);
    }
}
