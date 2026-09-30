//! Paths as the PowerShell engine builds and checks them. Paths travel as strings, as they do
//! in PowerShell, because they are compared, hashed and written into manifests as text.

use std::path::Path;

use super::{platform, EngineError, EngineResult};

#[cfg(windows)]
pub const SEP: char = '\\';
#[cfg(not(windows))]
pub const SEP: char = '/';

fn is_sep(c: char) -> bool { c == '/' || c == SEP }

/// `Get-KvkFullPath`: `[IO.Path]::GetFullPath`, then trailing separators trimmed (so a drive
/// root `C:\` becomes `C:`, as it does in PowerShell).
pub fn full_path(path: &str) -> EngineResult<String> {
    if path.trim().is_empty() { return Err(EngineError::plain("Path is empty.")); }
    let full = get_full_path(path)?;
    Ok(full.trim_end_matches(is_sep).to_string())
}

/// `[IO.Path]::GetFullPath`.
pub fn get_full_path(path: &str) -> EngineResult<String> {
    #[cfg(windows)]
    {
        // GetFullPathNameW, which is what .NET calls: `/` becomes `\`, `.` and `..` resolve,
        // trailing dots and spaces of a segment go, a `\\?\` path is left alone.
        std::path::absolute(path).map(|p| p.to_string_lossy().into_owned()).map_err(|e| EngineError::io(&e))
    }
    #[cfg(not(windows))]
    {
        let joined = if path.starts_with('/') { path.to_string() } else {
            let cwd = std::env::current_dir().map_err(|e| EngineError::io(&e))?;
            format!("{}/{}", cwd.to_string_lossy(), path)
        };
        let mut parts: Vec<&str> = Vec::new();
        for segment in joined.split('/') {
            match segment {
                "" | "." => {}
                ".." => { parts.pop(); }
                s => parts.push(s),
            }
        }
        let trailing = joined.ends_with('/') && !parts.is_empty();
        Ok(format!("/{}{}", parts.join("/"), if trailing { "/" } else { "" }))
    }
}

/// `Join-Path`: one separator between the two, and both separator kinds in the child written
/// as the platform's own (probe: `Join-Path 'C:\x' 'backups/abc'` is `C:\x\backups\abc`).
pub fn join(parent: &str, child: &str) -> String {
    let child: String = child.chars().map(|c| if is_sep(c) || c == '\\' { SEP } else { c }).collect();
    format!("{}{}{}", parent.trim_end_matches(|c| is_sep(c) || c == '\\'), SEP, child.trim_start_matches(SEP))
}

/// `[IO.Path]::GetDirectoryName`, or `None` at a root.
pub fn directory_name(path: &str) -> Option<String> {
    Path::new(path).parent().map(|p| p.to_string_lossy().into_owned()).filter(|p| !p.is_empty())
}

/// The last segment of a path.
pub fn file_name(path: &str) -> String {
    Path::new(path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

/// `[IO.Path]::GetExtension`: from the last dot of the last segment, or empty.
pub fn extension(name: &str) -> String {
    let base = name.rsplit(is_sep).next().unwrap_or(name);
    match base.rfind('.') { Some(i) if i + 1 < base.len() => base[i..].to_string(), _ => String::new() }
}

/// `Assert-KvkSafePath`: neither the path nor any ancestor may be a link or junction.
pub fn assert_safe_path(path: &str) -> EngineResult<()> {
    let mut current = full_path(path)?;
    loop {
        // Only a missing entry passes unchecked; any other failure to read it stops here, as
        // GetAttributes' other exceptions do in Assert-KvkSafePath.
        if platform::is_reparse_point(Path::new(&current)).map_err(|e| EngineError::io(&e))? == Some(true) {
            return Err(EngineError::plain(format!("Links and junctions are not allowed: \"{current}\"")));
        }
        match directory_name(&current) {
            Some(parent) if parent != current => current = parent,
            _ => break,
        }
    }
    Ok(())
}

/// `Assert-KvkFileName`: a single safe Windows file name.
pub fn assert_file_name(name: &str) -> EngineResult<()> {
    let bad_char = name.chars().any(|c| matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || (c as u32) < 0x20);
    let upper = name.to_ascii_uppercase();
    let stem = upper.split('.').next().unwrap_or("");
    let reserved = ["CON", "PRN", "AUX", "NUL"].contains(&stem)
        || (stem.len() == 4 && (stem.starts_with("COM") || stem.starts_with("LPT")) && matches!(stem.as_bytes()[3], b'1'..=b'9'));
    if name.is_empty() || bad_char || name.ends_with('.') || name.ends_with(' ') || reserved || name == "." || name == ".." {
        return Err(EngineError::plain(format!("Unsafe filename: \"{name}\"")));
    }
    Ok(())
}

/// The temporary folder with no link in its path, for tests: macOS keeps it behind `/var`, a
/// link the engine refuses. On Windows `canonicalize` would return a `\\?\` device path, which
/// the engine also refuses, so the folder is used as it is there.
pub fn temp_dir_without_links() -> std::path::PathBuf {
    let temp = std::env::temp_dir();
    if cfg!(windows) { temp } else { std::fs::canonicalize(&temp).unwrap_or(temp) }
}

/// Lowercase hex SHA-256 of `bytes`.
pub fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

/// `Get-KvkTextHash`: SHA-256 of the UTF-8 bytes.
pub fn text_hash(value: &str) -> String { sha256_hex(value.as_bytes()) }

/// True for a 64-character lowercase hex SHA-256, the only persisted hash form.
pub fn is_hash(value: &str) -> bool { is_lower_hex(value, 64) }

/// True for `len` lowercase hex characters and nothing else (the `\z`-anchored form of the
/// engine's checks; see the PowerShell fix list in the parity README).
pub fn is_lower_hex(value: &str, len: usize) -> bool {
    value.len() == len && value.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_names() {
        for good in ["PrimaryUserSettings.json", "音效 space.wav", "a.b.c", "COM0.txt", "CONSOLE.txt"] { assert!(assert_file_name(good).is_ok(), "{good}"); }
        for bad in ["", ".", "..", "a.", "a ", "a/b", "a:b", "CON", "con.txt", "LPT9", "nul.json", "a\u{1}"] { assert!(assert_file_name(bad).is_err(), "{bad}"); }
    }

    #[test]
    fn extensions_and_joins() {
        assert_eq!(extension("hit.WAV"), ".WAV");
        assert_eq!(extension("noext"), "");
        let joined = join(&format!("{SEP}x{SEP}"), "backups/abc");
        assert_eq!(joined, format!("{SEP}x{SEP}backups{SEP}abc"));
    }

    #[cfg(not(windows))]
    #[test]
    fn full_path_resolves_like_dotnet_on_unix() {
        assert_eq!(full_path("/a/b/../c/").unwrap(), "/a/c");
        assert_eq!(full_path("/a//./b").unwrap(), "/a/b");
        assert!(full_path("  ").is_err());
    }

    #[cfg(not(windows))]
    #[test]
    fn links_are_refused() {
        // The temp folder itself sits behind a link on macOS (/var -> /private/var).
        let dir = std::fs::canonicalize(std::env::temp_dir()).unwrap().join(format!("kvk-paths-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("real")).unwrap();
        std::os::unix::fs::symlink(dir.join("real"), dir.join("link")).unwrap();
        assert!(assert_safe_path(&dir.join("real/x").to_string_lossy()).is_ok());
        assert!(assert_safe_path(&dir.join("link/x").to_string_lossy()).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
