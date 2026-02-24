use std::fs;
use std::path::Path;

fn main() {
    let source_dir = "/Users/user/Documents/workspace/github/Reelfs/cache/thumbnails";
    let target_dir = "/Users/user/.reelfs/cache/thumbnails";
    
    println!("开始迁移缩略图...");
    println!("源目录: {}", source_dir);
    println!("目标目录: {}", target_dir);
    
    if !Path::new(target_dir).exists() {
        fs::create_dir_all(target_dir).expect("无法创建目标目录");
    }
    
    let entries = fs::read_dir(source_dir).expect("无法读取源目录");
    let mut count = 0;
    
    for entry in entries {
        if let Ok(entry) = entry {
            let path = entry.path();
            if path.extension().map_or(false, |ext| ext == "jpg" || ext == "jpeg") {
                let file_name = path.file_name().unwrap();
                let target_path = Path::new(target_dir).join(file_name);
                
                if !target_path.exists() {
                    fs::copy(&path, &target_path).expect(&format!("无法复制文件: {:?}", path));
                    count += 1;
                    println!("复制: {:?} -> {:?}", file_name, target_path);
                } else {
                    println!("跳过（已存在）: {:?}", file_name);
                }
            }
        }
    }
    
    println!("迁移完成！共复制 {} 个文件", count);
}