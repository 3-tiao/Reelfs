use std::path::{Path, PathBuf};
use unicode_normalization::UnicodeNormalization;

/// Normalize a file path string into Unicode NFC form so that filenames coming
/// from different APIs/filesystems (HFS+/APFS sometimes hand out NFD, while
/// the user's input or other crates produce NFC) compare equal at the byte
/// level — which is how SQLite's UNIQUE constraint sees them.
pub fn normalize_path_str(s: &str) -> String {
    s.nfc().collect()
}

pub fn normalize_path(path: &Path) -> String {
    normalize_path_str(&path.to_string_lossy())
}

/// Return a spelling of `path` that actually exists on disk.
///
/// The database keeps paths in NFC (see [`normalize_path_str`]), but not every
/// filesystem folds Unicode on lookup: macOS APFS normalizes NFC/NFD
/// transparently, while SMB / NFS / exFAT match bytes exactly. A NAS directory
/// named with decomposed characters (`か` + U+3099, i.e. NFD `が`) therefore
/// cannot be opened via its NFC spelling. Try the path as given, then its NFD
/// and NFC decompositions, before giving up.
pub fn resolve_fs_path(path: &Path) -> PathBuf {
    if path.exists() {
        return path.to_path_buf();
    }

    let original = path.to_string_lossy();
    for candidate in [
        original.nfd().collect::<String>(),
        original.nfc().collect::<String>(),
    ] {
        if candidate.as_str() != original.as_ref() {
            let candidate_path = PathBuf::from(&candidate);
            if candidate_path.exists() {
                debug_fallback(&candidate, path);
                return candidate_path;
            }
        }
    }

    path.to_path_buf()
}

fn debug_fallback(candidate: &str, original: &Path) {
    log::debug!(
        "[路径解析] 归一化回退命中: {:?} -> {:?}",
        original,
        candidate
    );
}

/// Resolve the base directory that holds the app's `.reelfs` folder (config,
/// database, thumbnail cache, logs). `REELFS_HOME` wins over `HOME` so an
/// agent can point the whole app at a sandbox; without it the real user home
/// is used and nothing changes.
pub fn reelfs_base_dir(reelfs_home: Option<&str>, home: Option<&str>) -> String {
    reelfs_home
        .map(str::to_string)
        .or_else(|| home.map(str::to_string))
        .unwrap_or_else(|| ".".to_string())
}

pub fn reelfs_base_dir_from_env() -> String {
    reelfs_base_dir(
        std::env::var("REELFS_HOME").ok().as_deref(),
        std::env::var("HOME").ok().as_deref(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use unicode_normalization::UnicodeNormalization;

    #[test]
    fn nfd_input_is_normalized_to_nfc() {
        // "café" decomposed (NFD), the form HFS+/APFS hand out for on-disk names.
        let nfd: String = "café".nfd().collect();
        assert_ne!(nfd, "café", "precondition: input must really be NFD");

        assert_eq!(normalize_path_str(&nfd), "café");
    }

    #[test]
    fn nfc_input_stays_nfc() {
        assert_eq!(normalize_path_str("café"), "café");
        assert_eq!(
            normalize_path_str("/NAS/Movies/流浪地球.mkv"),
            "/NAS/Movies/流浪地球.mkv"
        );
    }

    #[test]
    fn empty_and_ascii_paths_pass_through() {
        assert_eq!(normalize_path_str(""), "");
        assert_eq!(normalize_path_str("/nas/Movies/a.mkv"), "/nas/Movies/a.mkv");
    }

    #[test]
    fn normalize_path_accepts_path_and_preserves_nfc() {
        let nfd_dir: String = "Café".nfd().collect();
        let path = std::path::PathBuf::from(format!("/nas/{}/movie.mkv", nfd_dir));

        assert_eq!(normalize_path(&path), "/nas/Café/movie.mkv");
    }

    #[test]
    fn reelfs_home_override_wins_over_home() {
        assert_eq!(
            reelfs_base_dir(Some("/tmp/agent-sandbox"), Some("/Users/caiguo")),
            "/tmp/agent-sandbox"
        );
    }

    #[test]
    fn missing_reelfs_home_falls_back_to_home() {
        assert_eq!(
            reelfs_base_dir(None, Some("/Users/caiguo")),
            "/Users/caiguo"
        );
    }

    #[test]
    fn missing_both_env_vars_falls_back_to_cwd() {
        assert_eq!(reelfs_base_dir(None, None), ".");
    }

    #[test]
    fn resolve_existing_path_returns_itself() {
        let dir = std::env::temp_dir().join(format!(
            "reelfs_path_utils_{}_resolve",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("plain.mkv");
        std::fs::write(&file, b"x").unwrap();

        assert_eq!(resolve_fs_path(&file), file);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_missing_path_returns_input_unchanged() {
        let missing = std::env::temp_dir().join(format!(
            "reelfs_path_utils_{}_ghost.mkv",
            std::process::id()
        ));
        assert!(!missing.exists());
        assert_eq!(resolve_fs_path(&missing), missing);
    }

    /// The DB stores NFC, but an NFD-named file must still be reachable: the
    /// resolved path has to point at something that exists. On APFS the lookup
    /// already folds, on SMB it resolves via the NFD fallback — either way the
    /// contract holds.
    #[test]
    fn resolve_nfc_path_finds_nfd_file() {
        let dir = std::env::temp_dir().join(format!(
            "reelfs_path_utils_{}_nfd",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let nfd_name: String = "Café movie.mkv".nfd().collect();
        let nfd_file = dir.join(&nfd_name);
        std::fs::write(&nfd_file, b"x").unwrap();

        let nfc_name: String = "Café movie.mkv".nfc().collect();
        let nfc_path = dir.join(&nfc_name);

        assert!(
            resolve_fs_path(&nfc_path).exists(),
            "resolved path must exist for both NFC-stored and NFD-on-disk names"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
