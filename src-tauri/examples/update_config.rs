use std::fs;

fn main() {
    let config_path = "/Users/user/.reelfs/config.json";
    
    println!("读取配置文件: {}", config_path);
    
    let content = fs::read_to_string(config_path).expect("无法读取配置文件");
    
    println!("当前内容:\n{}", content);
    
    // 简单的字符串替换
    let new_content = content.replace(
        "\"cache_dir\": \"/Users/user/Documents/workspace/github/Reelfs/cache\"",
        "\"cache_dir\": \"/Users/user/.reelfs/cache\""
    );
    
    println!("新内容:\n{}", new_content);
    
    // 保存配置
    fs::write(config_path, new_content).expect("无法写入配置文件");
    
    println!("配置文件更新成功！");
}