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
    let cache_dir = "/Users/user/Documents/workspace/github/Reelfs/cache";
    let test_movies = vec![
        (3, "/Volumes/NAS/Movies/丘咲エミリ/[2017] 美人秘書の憂鬱 [110717-533]/poster.jpg"),
        (4, "/Volumes/NAS/Movies/美月アンジェリア/[2018] 美月アンジェリアがぼくのお嫁さん 〜ウェディングドレスに透けた美乳〜 [112318-798]/poster.jpg"),
        (5, "/Volumes/NAS/Movies/美月アンジェリア/[2019] 極上泡姫物語 Vol.64 [020119-851]/poster.jpg"),
    ];
    
    println!("开始批量生成缩略图...");
    println!("缓存目录: {}", cache_dir);
    
    // 创建缓存目录
    let thumbnails_dir = format!("{}/thumbnails", cache_dir);
    std::fs::create_dir_all(&thumbnails_dir).ok();
    
    let mut success_count = 0;
    let mut fail_count = 0;
    
    for (movie_id, poster_path) in &test_movies {
        let thumbnail_path = format!("{}/thumbnails/{}.jpg", cache_dir, movie_id);
        
        println!("\n处理电影 ID: {}", movie_id);
        println!("海报路径: {}", poster_path);
        println!("缩略图路径: {}", thumbnail_path);
        
        // 检查海报文件是否存在
        if !Path::new(poster_path).exists() {
            println!("❌ 海报文件不存在，跳过");
            fail_count += 1;
            continue;
        }
        
        // 检查缩略图是否已存在
        if Path::new(&thumbnail_path).exists() {
            println!("✅ 缩略图已存在，跳过");
            success_count += 1;
            continue;
        }
        
        // 读取并调整图片
        match image::open(poster_path) {
            Ok(img) => {
                let (width, height) = img.dimensions();
                println!("原始尺寸: {}x{}", width, height);
                
                let thumbnail = resize_to_fit(img, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
                let (new_width, new_height) = thumbnail.dimensions();
                println!("调整后尺寸: {}x{}", new_width, new_height);
                
                // 保存为JPEG格式
                match thumbnail.save_with_format(&thumbnail_path, ImageFormat::Jpeg) {
                    Ok(_) => {
                        if let Ok(metadata) = std::fs::metadata(&thumbnail_path) {
                            println!("✅ 缩略图生成成功，文件大小: {} bytes", metadata.len());
                            success_count += 1;
                        }
                    }
                    Err(e) => {
                        println!("❌ 缩略图保存失败: {:?}", e);
                        fail_count += 1;
                    }
                }
            }
            Err(e) => {
                println!("❌ 无法读取海报文件: {:?}", e);
                fail_count += 1;
            }
        }
    }
    
    println!("\n========================================");
    println!("批量生成完成:");
    println!("成功: {} 个", success_count);
    println!("失败: {} 个", fail_count);
    println!("总计: {} 个", test_movies.len());
    println!("========================================");
}