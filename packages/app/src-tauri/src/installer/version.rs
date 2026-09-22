//! What the App knows about itself: version label, build metadata, and semantic version comparison.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// App version metadata from the built package.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppVersion {
    /// Semantic version label (`0.1.3` or `0.1.3-rc.1`), always satisfies the backend's
    /// `^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$` pattern and is at most 40 characters. Guaranteed
    /// valid because `read_version_file` falls back to the compiled `env!("CARGO_PKG_VERSION")`.
    pub label: String,
    /// Commit SHA, at least 7 hex digits or the literal `"unknown"`. Guaranteed valid because
    /// `read_version_file` falls back to `"unknown"` if parsing fails.
    pub commit: String,
    /// ISO 8601 UTC timestamp. Non-empty, at most 40 characters. Falls back to `"unknown"`.
    pub built: String,
}

impl AppVersion {
    fn with_validated_fields(label: String, commit: String, built: String) -> Self {
        let label = if is_valid_label(&label) && label.len() <= 40 {
            label
        } else {
            env!("CARGO_PKG_VERSION").to_string()
        };
        let commit = if is_valid_commit(&commit) {
            commit
        } else {
            "unknown".to_string()
        };
        let built = if !built.is_empty() && built.len() <= 40 {
            built
        } else {
            "unknown".to_string()
        };
        Self { label, commit, built }
    }
}

fn is_valid_label(s: &str) -> bool {
    // Pattern: `^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$`
    // Valid: "0.1.3", "0.1.3-rc.1", "0.1.3-test.4"
    // Invalid: "0.1", "0.1.3.4", "v0.1.3", "0.1.3-", "0.1.3-rc-1" (multiple hyphens)
    let mut parts = s.splitn(2, '-');
    if let Some(version_part) = parts.next() {
        let version_nums: Vec<&str> = version_part.split('.').collect();
        if version_nums.len() != 3 {
            return false;
        }
        for num in version_nums {
            if !num.chars().all(|c| c.is_ascii_digit()) || num.is_empty() {
                return false;
            }
        }
        // Check prerelease part if present (must be exactly one hyphen, and prerelease cannot contain hyphens)
        if let Some(prerelease) = parts.next() {
            if prerelease.is_empty() {
                return false;
            }
            if !prerelease.chars().all(|c| c.is_ascii_alphanumeric() || c == '.') {
                return false;
            }
        }
        true
    } else {
        false
    }
}

fn is_valid_commit(s: &str) -> bool {
    // Pattern: `^([0-9a-f]{7,40}|unknown)$`
    if s == "unknown" {
        return true;
    }
    if s.len() < 7 || s.len() > 40 {
        return false;
    }
    s.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f'))
}

/// Read the VERSION.txt file and parse its three lines.
///
/// The file format is:
/// ```text
/// Aimloom 0.1.3
/// commit abc1234567890def...
/// built 2026-09-20 17:38:27 UTC
/// ```
///
/// Each field falls back to a safe default if parsing fails. The label also falls back
/// to the compiled `env!("CARGO_PKG_VERSION")` if the parsed value is invalid.
pub fn read_version_file(dir: &Path) -> AppVersion {
    let version_txt = dir.join("VERSION.txt");
    match std::fs::read_to_string(&version_txt) {
        Ok(content) => parse_version_content(&content),
        Err(_) => AppVersion::with_validated_fields(
            env!("CARGO_PKG_VERSION").to_string(),
            "unknown".to_string(),
            "unknown".to_string(),
        ),
    }
}

fn parse_version_content(content: &str) -> AppVersion {
    // The packager writes UTF-8 with a BOM, and `trim()` does not count U+FEFF as whitespace.
    let content = content.strip_prefix('\u{feff}').unwrap_or(content);
    let lines: Vec<&str> = content.lines().map(|l| l.trim()).collect();

    let mut label = "unknown".to_string();
    let mut commit = "unknown".to_string();
    let mut built = "unknown".to_string();

    for line in lines {
        if line.is_empty() {
            continue;
        }
        if line.starts_with("Aimloom ") {
            label = line.strip_prefix("Aimloom ").unwrap_or("").trim().to_string();
        } else if line.starts_with("commit ") {
            commit = line.strip_prefix("commit ").unwrap_or("").trim().to_string();
        } else if line.starts_with("built ") {
            built = line.strip_prefix("built ").unwrap_or("").trim().to_string();
        }
    }

    AppVersion::with_validated_fields(label, commit, built)
}

/// The running exe's own directory -- where the packager places `VERSION.txt` beside it. Never
/// the process's working directory, which a shortcut, a terminal launch or a drag-and-drop onto
/// the exe can each set differently.
fn exe_dir() -> PathBuf {
    std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf)).unwrap_or_default()
}

static RESOLVED_VERSION: OnceLock<AppVersion> = OnceLock::new();

/// The App's own version, resolved once from `VERSION.txt` next to the running exe. Every caller
/// -- the report's `app.label`, the update-check payload, and the User-Agent header -- reads this
/// same cached value, so they can no longer disagree about "which build sent this" depending on
/// where the process happened to be launched from.
pub fn resolved_version() -> &'static AppVersion {
    RESOLVED_VERSION.get_or_init(|| read_version_file(&exe_dir()))
}

/// `Aimloom/<version>` — the exact `user-agent` header the App sends. Non-whitespace,
/// non-quote, header-safe characters only. Uses the same exe-relative, once-resolved version as
/// every other reader of the App's label; if parsing fails, the compiled `CARGO_PKG_VERSION` is
/// used as fallback.
pub fn label_for_user_agent() -> String {
    format_user_agent(&resolved_version().label)
}

fn format_user_agent(label: &str) -> String {
    // Remove any character not in [0-9A-Za-z.\-/]
    let cleaned: String = label
        .chars()
        .filter(|c| matches!(c, '0'..='9' | 'A'..='Z' | 'a'..='z' | '.' | '-' | '/'))
        .collect();
    format!("Aimloom/{}", cleaned)
}

/// Compare two semantic versions. Returns `true` if `latest` is strictly newer than `current`.
///
/// Semantic version comparison rules:
/// - Versions are compared by numeric parts (0.1.3 > 0.1.2)
/// - Pre-release versions never count as newer than their release version (0.1.3-rc.1 is not newer than 0.1.3)
/// - Unparsable versions (empty, leading 'v', wrong number of parts, huge numbers) return `false`
pub fn is_newer(latest: &str, current: &str) -> bool {
    let latest_parts = match parse_semver(latest) {
        Some(p) => p,
        None => return false,
    };
    let current_parts = match parse_semver(current) {
        Some(p) => p,
        None => return false,
    };

    // If latest has a prerelease, it's never newer
    if latest_parts.has_prerelease {
        return false;
    }

    // Compare numeric parts: major, minor, patch
    if latest_parts.major != current_parts.major {
        return latest_parts.major > current_parts.major;
    }
    if latest_parts.minor != current_parts.minor {
        return latest_parts.minor > current_parts.minor;
    }
    if latest_parts.patch != current_parts.patch {
        return latest_parts.patch > current_parts.patch;
    }

    false
}

#[derive(Debug)]
struct SemverParts {
    major: u64,
    minor: u64,
    patch: u64,
    has_prerelease: bool,
}

fn parse_semver(version: &str) -> Option<SemverParts> {
    let version = version.trim();
    if version.is_empty() {
        return None;
    }

    // Check for leading 'v' and reject it
    if version.starts_with('v') || version.starts_with('V') {
        return None;
    }

    // Check if there's a prerelease part
    let (base_version, has_prerelease) = if let Some(dash_pos) = version.find('-') {
        (version[..dash_pos].to_string(), true)
    } else {
        (version.to_string(), false)
    };

    let parts: Vec<&str> = base_version.split('.').collect();
    if parts.len() != 3 {
        return None;
    }

    // Parse numeric parts with overflow protection
    let major = parts[0].parse::<u64>().ok()?;
    let minor = parts[1].parse::<u64>().ok()?;
    let patch = parts[2].parse::<u64>().ok()?;

    Some(SemverParts { major, minor, patch, has_prerelease })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn test_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("kvk-version-test-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    // ============================================================================
    // read_version_file tests
    // ============================================================================

    #[test]
    fn read_version_file_missing() {
        let dir = test_dir("missing");
        let version = read_version_file(&dir);
        assert_eq!(version.label, env!("CARGO_PKG_VERSION"));
        assert_eq!(version.commit, "unknown");
        assert_eq!(version.built, "unknown");
    }

    #[test]
    fn read_version_file_well_formed() {
        let dir = test_dir("well-formed");
        fs::write(
            dir.join("VERSION.txt"),
            "Aimloom 0.1.3\ncommit abc1234567890def\nbuilt 2026-09-20 17:38:27 UTC",
        )
        .unwrap();
        let version = read_version_file(&dir);
        assert_eq!(version.label, "0.1.3");
        assert_eq!(version.commit, "abc1234567890def");
        assert_eq!(version.built, "2026-09-20 17:38:27 UTC");
    }

    #[test]
    fn read_version_file_with_crlf_endings() {
        let dir = test_dir("crlf");
        fs::write(
            dir.join("VERSION.txt"),
            "Aimloom 0.1.3\r\ncommit abc1234567890def\r\nbuilt 2026-09-20 17:38:27 UTC\r\n",
        )
        .unwrap();
        let version = read_version_file(&dir);
        assert_eq!(version.label, "0.1.3");
        assert_eq!(version.commit, "abc1234567890def");
        assert_eq!(version.built, "2026-09-20 17:38:27 UTC");
    }

    #[test]
    fn read_version_file_empty() {
        let dir = test_dir("empty");
        fs::write(dir.join("VERSION.txt"), "").unwrap();
        let version = read_version_file(&dir);
        assert_eq!(version.label, env!("CARGO_PKG_VERSION"));
        assert_eq!(version.commit, "unknown");
        assert_eq!(version.built, "unknown");
    }

    #[test]
    fn read_version_file_one_line_only() {
        let dir = test_dir("one-line");
        fs::write(dir.join("VERSION.txt"), "Aimloom 0.1.3").unwrap();
        let version = read_version_file(&dir);
        assert_eq!(version.label, "0.1.3");
        assert_eq!(version.commit, "unknown");
        assert_eq!(version.built, "unknown");
    }

    #[test]
    fn read_version_file_wrong_order() {
        let dir = test_dir("wrong-order");
        fs::write(
            dir.join("VERSION.txt"),
            "built 2026-09-20 17:38:27 UTC\ncommit abc1234567890def\nAimloom 0.1.3",
        )
        .unwrap();
        let version = read_version_file(&dir);
        assert_eq!(version.label, "0.1.3");
        assert_eq!(version.commit, "abc1234567890def");
        assert_eq!(version.built, "2026-09-20 17:38:27 UTC");
    }

    #[test]
    fn read_version_file_long_first_line() {
        let dir = test_dir("long-line");
        let long_label = "0.1.3-this-is-a-very-long-prerelease-identifier-that-exceeds-limits";
        fs::write(
            dir.join("VERSION.txt"),
            format!("Aimloom {}\ncommit abc1234567890def\nbuilt 2026-09-20 17:38:27 UTC", long_label),
        )
        .unwrap();
        let version = read_version_file(&dir);
        // Falls back because label is too long
        assert_eq!(version.label, env!("CARGO_PKG_VERSION"));
        assert_eq!(version.commit, "abc1234567890def");
    }

    #[test]
    fn read_version_file_non_ascii() {
        let dir = test_dir("non-ascii");
        fs::write(
            dir.join("VERSION.txt"),
            "Aimloom 0.1.3\ncommit abc1234567890def\nbuilt 构建时间 UTC",
        )
        .unwrap();
        let version = read_version_file(&dir);
        assert_eq!(version.label, "0.1.3");
        assert_eq!(version.commit, "abc1234567890def");
        // Non-ASCII characters make the built string invalid if it exceeds limits
        assert!(!version.built.is_empty());
        assert!(version.built.len() <= 40);
    }

    #[test]
    fn read_version_file_test_build() {
        let dir = test_dir("test-build");
        fs::write(
            dir.join("VERSION.txt"),
            "Aimloom 0.1.2-test.4\ncommit abc1234\nbuilt 2026-09-20 12:00:00 UTC",
        )
        .unwrap();
        let version = read_version_file(&dir);
        assert_eq!(version.label, "0.1.2-test.4");
        assert_eq!(version.commit, "abc1234");
    }

    // ============================================================================
    // label_for_user_agent tests
    // ============================================================================

    #[test]
    fn label_for_user_agent_is_always_safe() {
        // Consolidated: format, no spaces, no newlines, no quotes, safe chars only, special chars stripped
        let tests = vec![
            ("0.1.3", "Aimloom/0.1.3"),
            ("0.1.3 rc1", "Aimloom/0.1.3rc1"),          // no spaces
            ("0.1.3\nrc1", "Aimloom/0.1.3rc1"),          // no newlines
            ("0.1.3\"rc1", "Aimloom/0.1.3rc1"),          // no quotes
            ("0.1.3-rc.1", "Aimloom/0.1.3-rc.1"),        // preserves valid chars
            ("0.1.3!@#$%^&*()", "Aimloom/0.1.3"),        // strips special chars
        ];
        for (input, expected) in tests {
            let agent = format_user_agent(input);
            assert_eq!(agent, expected, "Failed for input: {}", input);
            // Verify all characters are safe
            for c in agent.chars() {
                assert!(
                    matches!(c, '0'..='9' | 'A'..='Z' | 'a'..='z' | '.' | '-' | '/'),
                    "Character '{}' is not safe in user agent",
                    c
                );
            }
        }
    }

    // ============================================================================
    // is_newer tests - brief requirements
    // ============================================================================

    /// `package-test-build.ps1` writes VERSION.txt as UTF-8 **with a BOM** and CRLF. `trim()` does
    /// not treat U+FEFF as whitespace, so the first line failed its prefix match and the label
    /// silently fell back to the compiled version: the first real report from `0.1.3-test.2`
    /// arrived labelled `0.1.3`. These are the packager's exact bytes, not a tidy fixture.
    #[test]
    fn a_version_file_with_the_packagers_bom_and_crlf_is_read_not_silently_replaced() {
        let content = "\u{feff}Aimloom 0.1.3-test.2\r\ncommit 3283f7f0000000000000000000000000000000ab\r\nbuilt 2026-09-21 19:27:08 UTC\r\n";
        let version = parse_version_content(content);
        assert_eq!(version.label, "0.1.3-test.2");
        assert_eq!(version.commit, "3283f7f0000000000000000000000000000000ab");
        assert_eq!(version.built, "2026-09-21 19:27:08 UTC");
    }

    #[test]
    fn is_newer_basic_true() {
        assert!(is_newer("0.1.3", "0.1.2"));
    }

    #[test]
    fn is_newer_basic_false_equal() {
        assert!(!is_newer("0.1.2", "0.1.2"));
    }

    #[test]
    fn is_newer_basic_false_older() {
        assert!(!is_newer("0.1.2", "0.1.3"));
    }

    #[test]
    fn is_newer_major_version() {
        assert!(is_newer("0.2.0", "0.1.9"));
    }

    #[test]
    fn is_newer_patch_version() {
        assert!(is_newer("0.1.10", "0.1.9"));
    }

    #[test]
    fn is_newer_prerelease_not_newer() {
        assert!(!is_newer("0.1.3-rc.1", "0.1.2"));
    }

    #[test]
    fn is_newer_empty_string() {
        assert!(!is_newer("", "0.1.2"));
    }

    // ============================================================================
    // is_newer tests - additional edge cases
    // ============================================================================

    #[test]
    fn is_newer_with_leading_v_is_unparsable() {
        // Versions with leading 'v' are unparsable; should return false
        assert!(!is_newer("v0.1.3", "0.1.2"));      // latest with leading v
        assert!(!is_newer("0.1.3", "v0.1.2"));      // current with leading v
    }

    #[test]
    fn is_newer_four_parts() {
        // Four-part versions are unparsable; should return false
        assert!(!is_newer("0.1.3.1", "0.1.2.0"));
    }

    #[test]
    fn is_newer_missing_part() {
        // Missing parts make version unparsable; should return false
        assert!(!is_newer("0.1", "0.1.2"));
    }

    #[test]
    fn is_newer_huge_number() {
        // Huge numbers that overflow u64 should return false on parse failure
        // u64::MAX = 18446744073709551615
        assert!(!is_newer("99999999999999999999.0.0", "0.1.0"));
    }

    #[test]
    fn is_newer_prerelease_never_counts_as_newer() {
        // Prerelease versions never count as newer, regardless of numeric relationship
        assert!(!is_newer("0.1.3-rc.1", "0.1.3"));       // same base version: prerelease < release
        assert!(!is_newer("0.1.3-rc.1", "0.1.2"));       // lower numeric version still not newer
        assert!(!is_newer("0.1.4-rc.1", "0.1.3"));       // even higher base still not newer
        assert!(!is_newer("0.1.3-rc.2", "0.1.3-rc.1")); // both prerelease: not newer
    }

    #[test]
    fn is_newer_current_empty() {
        // Current is empty (unparsable); should return false
        assert!(!is_newer("0.1.3", ""));
    }

    #[test]
    fn is_newer_trailing_dot() {
        // Invalid format with trailing dot
        assert!(!is_newer("0.1.3.", "0.1.2"));
    }

    // ============================================================================
    // Validation function tests
    // ============================================================================

    #[test]
    fn is_valid_label_valid_basic() {
        assert!(is_valid_label("0.1.3"));
    }

    #[test]
    fn is_valid_label_valid_prerelease() {
        assert!(is_valid_label("0.1.3-rc.1"));
        assert!(is_valid_label("0.1.3-test.4"));
    }

    #[test]
    fn is_valid_label_invalid_two_parts() {
        assert!(!is_valid_label("0.1"));
    }

    #[test]
    fn is_valid_label_invalid_four_parts() {
        assert!(!is_valid_label("0.1.3.4"));
    }

    #[test]
    fn is_valid_label_invalid_leading_v() {
        assert!(!is_valid_label("v0.1.3"));
    }

    #[test]
    fn is_valid_label_invalid_trailing_prerelease() {
        assert!(!is_valid_label("0.1.3-"));
    }

    #[test]
    fn a_label_the_backend_would_refuse_is_never_produced() {
        // The live backend's rule is ^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$ — ONE hyphen, and the
        // prerelease part may not contain another. A label it refuses loses the player's report.
        assert!(!is_valid_label("0.1.3-rc-1"));
        assert!(!is_valid_label("0.1.3-rc-1-final"));
        assert!(!is_valid_label("0.1.3-"));
        assert!(is_valid_label("0.1.3"));
        assert!(is_valid_label("0.1.3-test.4"));
        assert!(is_valid_label("0.1.3-rc.1"));
    }

    #[test]
    fn a_multi_hyphen_version_file_falls_back_instead_of_shipping_a_bad_label() {
        // read_version_file must fall back to the compiled version rather than forward it.
        let dir = test_dir("multi-hyphen");
        fs::write(dir.join("VERSION.txt"), "Aimloom 0.1.3-rc-1\ncommit abc1234\nbuilt 2026-09-20 12:00:00 UTC").unwrap();
        assert_eq!(read_version_file(&dir).label, env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn a_version_number_too_large_for_the_comparison_is_not_called_newer() {
        // Honest names: say which case each literal is.
        assert!(is_newer("999999999999.0.0", "0.1.0"));            // ~10^12 fits in u64: genuinely newer
        assert!(!is_newer("99999999999999999999999.0.0", "0.1.0")); // does not fit: refuse to claim newer
    }

    #[test]
    fn is_valid_commit_valid_short() {
        assert!(is_valid_commit("abc1234"));
    }

    #[test]
    fn is_valid_commit_valid_long() {
        assert!(is_valid_commit("abc1234567890def"));
    }

    #[test]
    fn is_valid_commit_valid_unknown() {
        assert!(is_valid_commit("unknown"));
    }

    #[test]
    fn is_valid_commit_invalid_too_short() {
        assert!(!is_valid_commit("abc123"));
    }

    #[test]
    fn is_valid_commit_invalid_non_hex() {
        assert!(!is_valid_commit("abcg1234567"));
    }
}
