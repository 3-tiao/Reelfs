use std::path::Path;
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
}
