use image::{ImageFormat, ImageResult, DynamicImage, GenericImageView};
use std::path::Path;
use std::fs;
use log::{info, debug, warn, error};

const THUMBNAIL_WIDTH: u32 = 300;
const THUMBNAIL_HEIGHT: u32 = 450;

pub fn ensure_cache_dir(cache_dir: &str) -> std::io::Result<()> {
    let thumbnails_dir = format!("{}/thumbnails", cache_dir);
    debug!("[缩略图生成] 创建缓存目录: {}", thumbnails_dir);
    fs::create_dir_all(&thumbnails_dir)?;
    info!("[缩略图生成] 缓存目录创建成功: {}", thumbnails_dir);
    Ok(())
}

pub fn generate_thumbnail(
    source_path: &str,
    output_path: &str,
) -> ImageResult<()> {
    let start_time = std::time::Instant::now();
    
    debug!("[缩略图生成] 开始处理: source={}, output={}", source_path, output_path);
    
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
            "HTTP URLs not supported yet"
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
    info!("[缩略图生成] 生成完成: {}，耗时: {}ms", output_path, elapsed.as_millis());
    
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
