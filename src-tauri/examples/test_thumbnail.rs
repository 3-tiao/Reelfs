use image::{ImageFormat, DynamicImage, GenericImageView};
use std::path::Path;

fn main() {
    let source_path = "/Volumes/NAS/Movies/丘咲エミリ/[2017] 美人秘書の憂鬱 [110717-533]/poster.jpg";
    let output_path = "/Users/user/.reelfs/cache/thumbnails/test.jpg";
    
    println!("开始测试缩略图生成...");
    println!("源文件: {}", source_path);
    println!("目标文件: {}", output_path);
    
    // 创建目录
    if let Some(parent) = Path::new(output_path).parent() {
        std::fs::create_dir_all(parent).expect("无法创建目录");
    }
    
    // 读取图片
    let img = image::open(source_path).expect("无法读取图片");
    println!("原始尺寸: {}x{}", img.width(), img.height());
    
    // 调整尺寸
    let thumbnail = img.resize(300, 450, image::imageops::FilterType::Lanczos3);
    println!("调整后尺寸: {}x{}", thumbnail.width(), thumbnail.height());
    
    // 保存
    thumbnail.save_with_format(output_path, ImageFormat::Jpeg).expect("无法保存");
    println!("缩略图生成成功！");
}