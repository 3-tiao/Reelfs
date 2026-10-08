{
  description = "Reelfs dev shell — Tauri v2 (webkitgtk) + 前端，构建依赖全在这声明";

  # 跟 ~/Documents/nixos 的系统 pin 一致：dev shell 里的 gtk/webkit 与
  # 系统运行时同一份闭包，避免「编译用的头文件 ≠ 运行时的 so」。
  # 系统升级 pin 之后这里也要跟着动（rev 见那边 flake.lock 的 nixpkgs）。
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/151fa4e8ddfdd8dd25d945ad94ed54a13de9f6e4";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in {
      devShells = forAllSystems (pkgs:
        let
          # Rust 工具链必须同源（rustc/clippy/rustfmt 版本不一致会直接报错）
          rust = with pkgs; [ rustc cargo clippy rustfmt rust-analyzer ];

          # cargo build / clippy 链接所需的系统库（-sys crate 通过 pkg-config 找）
          gtkDeps = with pkgs; [
            gtk3
            webkitgtk_4_1
            cairo
            pango
            gdk-pixbuf
            glib
            libsoup_3
            at-spi2-core # atk
            dbus
            harfbuzz
            zlib
          ];

          # nodejs 版本跟随仓库实际使用的 major（node_modules 按它装的）
          node = pkgs.nodejs_24;

          # GTK 靠这些 schema 读字体缩放、主题、文件选择框等设置。读不到时
          # WebKitGTK 会把 device scale factor 算成负数（webview 视口整个崩），
          # GTK 打开文件选择框也会直接 abort。
          # 必须同时包含 gtk3 自己的 schema（org.gtk.Settings.*），只给
          # gsettings-desktop-schemas 不够。
          schemaDirs = with pkgs; [
            "${gtk3}/share/gsettings-schemas/${gtk3.name}/glib-2.0/schemas"
            "${gsettings-desktop-schemas}/share/gsettings-schemas/${gsettings-desktop-schemas.name}/glib-2.0/schemas"
          ];
        in {
          default = pkgs.mkShell {
            nativeBuildInputs = [ pkgs.pkg-config ] ++ rust ++ [ node ];
            buildInputs = gtkDeps;

            # 沙盒样本媒体生成（scripts/agent-env.sh）用；顺带避免脚本再走 nix 回退
            packages = [ pkgs.ffmpeg ];

            # rust-analyzer 需要 std 源码
            RUST_SRC_PATH = "${pkgs.rustPlatform.rustLibSrc}";

            GSETTINGS_SCHEMA_DIR = pkgs.lib.concatStringsSep ":" schemaDirs;
          };
        });
    };
}
