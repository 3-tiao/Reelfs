use std::path::Path;
use image::{ImageFormat, DynamicImage, GenericImageView};

const THUMBNAIL_WIDTH: u32 = 300;
const THUMBNAIL_HEIGHT: u32 = 450;

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

fn main() {
    let source_path = "/Volumes/NAS/Movies/丘咲エミリ/[2017] 美人秘書の憂鬱 [110717-533]/poster.jpg";
    let output_path_webp = "/Users/user/Documents/workspace/github/Reelfs/cache/thumbnails/test.webp";
    let output_path_jpg = "/Users/user/Documents/workspace/github/Reelfs/cache/thumbnails/test.jpg";
    
    println!("测试缩略图生成 (新缓存目录):");
    println!("源文件: {}", source_path);
    println!("目标文件 (WebP): {}", output_path_webp);
    println!("目标文件 (JPEG): {}", output_path_jpg);
    
    // 创建输出目录
    if let Some(parent) = Path::new(output_path_webp).parent() {
        std::fs::create_dir_all(parent).ok();
    }
    
    // 读取图片
    let img = image::open(source_path).expect("无法读取图片");
    let (width, height) = img.dimensions();
    println!("原始尺寸: {}x{}", width, height);
    
    // 调整大小
    let thumbnail = resize_to_fit(img, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
    let (new_width, new_height) = thumbnail.dimensions();
    println!("调整后尺寸: {}x{}", new_width, new_height);
    
    // 尝试保存为JPEG格式
    println!("\n尝试保存为JPEG格式...");
    match thumbnail.save_with_format(output_path_jpg, ImageFormat::Jpeg) {
        Ok(_) => {
            println!("JPEG格式保存成功!");
            if Path::new(output_path_jpg).exists() {
                let metadata = std::fs::metadata(output_path_jpg).expect("无法获取文件信息");
                println!("JPEG文件大小: {} bytes", metadata.len());
            }
        }
        Err(e) => {
            println!("JPEG格式保存失败: {:?}", e);
        }
    }
    
    // 尝试保存为WebP格式
    println!("\n尝试保存为WebP格式...");
    match thumbnail.save_with_format(output_path_webp, ImageFormat::WebP) {
        Ok(_) => {
            println!("WebP格式保存成功!");
            if Path::new(output_path_webp).exists() {
                let metadata = std::fs::metadata(output_path_webp).expect("无法获取文件信息");
                println!("WebP文件大小: {} bytes", metadata.len());
            }
        }
        Err(e) => {
            println!("WebP格式保存失败: {:?}", e);
        }
    }
    
    println!("\n测试完成!");
}