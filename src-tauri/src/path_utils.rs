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
