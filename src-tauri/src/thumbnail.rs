use image::{DynamicImage, GenericImageView, ImageFormat, ImageResult};
use log::{debug, error, info};
use std::fs;
use std::path::Path;

const THUMBNAIL_WIDTH: u32 = 300;
const THUMBNAIL_HEIGHT: u32 = 450;

pub fn ensure_cache_dir(cache_dir: &str) -> std::io::Result<()> {
    let thumbnails_dir = format!("{}/thumbnails", cache_dir);
    debug!("[缩略图生成] 创建缓存目录: {}", thumbnails_dir);
    fs::create_dir_all(&thumbnails_dir)?;
    info!("[缩略图生成] 缓存目录创建成功: {}", thumbnails_dir);
    Ok(())
}

pub fn generate_thumbnail(source_path: &str, output_path: &str) -> ImageResult<()> {
    let start_time = std::time::Instant::now();

    debug!(
        "[缩略图生成] 开始处理: source={}, output={}",
        source_path, output_path
    );

    if Path::new(output_path).exists() {
        debug!("[缩略图生成] 缩略图已存在，跳过生成: {}", output_path);
        return Ok(());
    }

    if let Some(parent) = Path::new(output_path).parent() {
        fs::create_dir_all(parent).ok();
    }

    let img = if source_path.starts_with("http://") || source_path.starts_with("https://") {
        error!("[缩略图生成] 不支持HTTP URL: {}", source_path);
        return Err(image::ImageError::IoError(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "HTTP URLs not supported yet",
        )));
    } else {
        image::open(source_path)?
    };

    let (width, height) = img.dimensions();
    debug!("[缩略图生成] 原始尺寸: {}x{}", width, height);

    let thumbnail = resize_to_fit(img, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);

    let (new_width, new_height) = thumbnail.dimensions();
    debug!("[缩略图生成] 调整后尺寸: {}x{}", new_width, new_height);

    thumbnail.save_with_format(output_path, ImageFormat::Jpeg)?;

    let elapsed = start_time.elapsed();
    info!(
        "[缩略图生成] 生成完成: {}，耗时: {}ms",
        output_path,
        elapsed.as_millis()
    );

    Ok(())
}

fn resize_to_fit(img: DynamicImage, max_width: u32, max_height: u32) -> DynamicImage {
    let (width, height) = img.dimensions();

    let ratio = (max_width as f32 / width as f32).min(max_height as f32 / height as f32);

    if ratio >= 1.0 {
        return img;
    }

    let new_width = (width as f32 * ratio) as u32;
    let new_height = (height as f32 * ratio) as u32;

    img.resize(new_width, new_height, image::imageops::FilterType::Lanczos3)
}

pub fn get_thumbnail_path(cache_dir: &str, movie_id: i64) -> String {
    format!("{}/thumbnails/{}.jpg", cache_dir, movie_id)
}

pub fn get_cache_size(cache_dir: &str) -> std::io::Result<u64> {
    let thumbnails_dir = format!("{}/thumbnails", cache_dir);
    let mut total_size = 0u64;

    if let Ok(entries) = fs::read_dir(thumbnails_dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            if let Ok(metadata) = entry.metadata() {
                total_size += metadata.len();
            }
        }
    }

    Ok(total_size)
}

pub fn clear_cache(cache_dir: &str) -> std::io::Result<()> {
    let thumbnails_dir = format!("{}/thumbnails", cache_dir);
    if Path::new(&thumbnails_dir).exists() {
        fs::remove_dir_all(&thumbnails_dir)?;
        fs::create_dir_all(&thumbnails_dir)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("reelfs_thumb_{}_{}", std::process::id(), name));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn ensure_cache_dir_creates_and_is_idempotent() {
        let dir = temp_dir("cache_dir");
        let cache = dir.join("cache");
        let cache_str = cache.to_str().unwrap();

        ensure_cache_dir(cache_str).unwrap();
        assert!(cache.join("thumbnails").is_dir());

        // Second call must not error on an existing directory.
        ensure_cache_dir(cache_str).unwrap();
    }

    #[test]
    fn thumbnail_path_layout_is_stable() {
        assert_eq!(
            get_thumbnail_path("/data/cache", 42),
            "/data/cache/thumbnails/42.jpg"
        );
        assert_eq!(
            get_thumbnail_path("/data/cache", 0),
            "/data/cache/thumbnails/0.jpg"
        );
    }

    #[test]
    fn cache_size_sums_only_the_thumbnails_dir_and_clear_resets_it() {
        let dir = temp_dir("cache_size");
        let cache_str = dir.join("cache").to_str().unwrap().to_string();
        ensure_cache_dir(&cache_str).unwrap();

        assert_eq!(get_cache_size(&cache_str).unwrap(), 0, "empty cache");

        let thumbs = dir.join("cache").join("thumbnails");
        fs::write(thumbs.join("1.jpg"), vec![0u8; 100]).unwrap();
        fs::write(thumbs.join("2.jpg"), vec![0u8; 250]).unwrap();
        // A sibling file outside thumbnails/ must not be counted.
        fs::write(dir.join("cache").join("stray.txt"), vec![0u8; 9999]).unwrap();

        assert_eq!(get_cache_size(&cache_str).unwrap(), 350);

        clear_cache(&cache_str).unwrap();
        assert!(thumbs.is_dir(), "clear must leave the directory in place");
        assert_eq!(get_cache_size(&cache_str).unwrap(), 0);
    }

    #[test]
    fn clear_cache_on_missing_dir_is_a_noop() {
        let dir = temp_dir("clear_missing");
        let missing = dir.join("never_created").to_str().unwrap().to_string();
        clear_cache(&missing).unwrap();
        assert!(ensure_cache_dir(&missing).is_ok());
    }

    #[test]
    fn resize_to_fit_never_upscales() {
        let small = DynamicImage::new_rgb8(100, 60);
        let kept = resize_to_fit(small, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
        assert_eq!(
            kept.dimensions(),
            (100, 60),
            "smaller-than-target images pass through untouched"
        );
    }

    #[test]
    fn resize_to_fit_scales_by_the_limiting_ratio() {
        // 600x1200 against 300x450: ratios 0.5 and 0.375 — height is the limiter.
        let tall = DynamicImage::new_rgb8(600, 1200);
        let shrunk = resize_to_fit(tall, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
        assert_eq!(shrunk.dimensions(), (225, 450));
    }

    #[test]
    fn generate_thumbnail_skips_existing_output_without_touching_source() {
        let dir = temp_dir("skip_existing");
        // Output exists, source does NOT — the early return must win before open().
        let output = dir.join("out.jpg");
        fs::write(&output, b"existing").unwrap();

        let result = generate_thumbnail(
            dir.join("ghost.png").to_str().unwrap(),
            output.to_str().unwrap(),
        );
        assert!(result.is_ok(), "existing output must short-circuit");
        assert_eq!(
            fs::read(&output).unwrap(),
            b"existing",
            "output must be left untouched"
        );
    }

    #[test]
    fn generate_thumbnail_rejects_http_sources_as_unsupported() {
        let dir = temp_dir("http_reject");
        let output = dir.join("out.jpg");

        let err = generate_thumbnail("http://example.com/poster.jpg", output.to_str().unwrap())
            .expect_err("http sources must be rejected");
        assert!(
            matches!(err, image::ImageError::IoError(ref e) if e.kind() == std::io::ErrorKind::Unsupported),
            "expected io::ErrorKind::Unsupported, got {:?}",
            err
        );
        assert!(!output.exists());
    }

    #[test]
    fn generate_thumbnail_produces_a_jpeg_within_bounds() {
        let dir = temp_dir("generate");
        let cache_str = dir.join("cache").to_str().unwrap().to_string();
        ensure_cache_dir(&cache_str).unwrap();

        // 600x1200 white poster; 0.375 is exactly representable in f32, so the
        // expected output size is deterministic: (225, 450).
        let source = DynamicImage::new_rgb8(600, 1200);
        let source_path = dir.join("poster.png");
        source
            .save_with_format(&source_path, ImageFormat::Png)
            .unwrap();

        let output = get_thumbnail_path(&cache_str, 7);
        generate_thumbnail(source_path.to_str().unwrap(), &output).unwrap();

        let produced = image::open(&output).expect("output must be a readable image");
        assert_eq!(produced.dimensions(), (225, 450));

        // Regenerating onto the same output is a cheap no-op, not a rewrite.
        let meta = fs::metadata(&output).unwrap();
        generate_thumbnail(source_path.to_str().unwrap(), &output).unwrap();
        assert_eq!(
            fs::metadata(&output).unwrap().modified().unwrap(),
            meta.modified().unwrap()
        );
    }
}
