{
  description = "Reelfs — Tauri v2 电影浏览器（dev shell + nix 打包）";

  inputs = {
    # 唯一的 nixpkgs pin：两台机器（mac 开发机 / NixOS 使用机）的 rustc、node、
    # ffmpeg 都来自这一个闭包。Linux 端用 .#reelfs 安装时，运行时 so 也在
    # 闭包里、不依赖系统 nixpkgs —— 因此不需要再和 NixOS 系统 pin 手动同步。
    # 升级 pin：改这里的 rev 后跑 `nix flake update`，CI 会重新验证。
    nixpkgs.url = "github:NixOS/nixpkgs/151fa4e8ddfdd8dd25d945ad94ed54a13de9f6e4";

    # Rust 打包：cargo 依赖分层缓存 + 干净的源码过滤
    crane.url = "github:ipetkov/crane";
  };

  outputs = { self, nixpkgs, crane }:
    let
      lib = nixpkgs.lib;
      systems = [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" ];
      forAllSystems = f: lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});

      perSystem = forAllSystems (pkgs:
        let
          isLinux = pkgs.stdenv.hostPlatform.isLinux;
          craneLib = crane.mkLib pkgs;

          # Rust 工具链必须同源（rustc/clippy/rustfmt 版本不一致会直接报错）
          rust = with pkgs; [ rustc cargo clippy rustfmt rust-analyzer ];

          # nodejs 版本跟随仓库实际使用的 major（node_modules 按它装的）
          node = pkgs.nodejs_24;

          # Linux only：cargo build / clippy 链接所需的系统库（-sys crate 通过
          # pkg-config 找）。glib/cairo/pango/gdk-pixbuf/harfbuzz/zlib 已由
          # gtk3/webkitgtk 闭包传播，不重复列出。
          # macOS 上 Tauri 用系统 WKWebView（Xcode SDK），无系统库依赖。
          linuxGtk = with pkgs; [
            gtk3
            webkitgtk_4_1
            libsoup_3
            at-spi2-core # atk
            dbus
          ];

          # Linux only：GTK 靠这些 schema 读字体缩放、主题、文件选择框等设置。读不到时
          # WebKitGTK 会把 device scale factor 算成负数（webview 视口整个崩），
          # GTK 打开文件选择框也会直接 abort。
          # 必须同时包含 gtk3 自己的 schema（org.gtk.Settings.*），只给
          # gsettings-desktop-schemas 不够。
          schemaDirs = with pkgs; [
            "${gtk3}/share/gsettings-schemas/${gtk3.name}/glib-2.0/schemas"
            "${gsettings-desktop-schemas}/share/gsettings-schemas/${gsettings-desktop-schemas.name}/glib-2.0/schemas"
          ];

          # ---- 前端：vite build → dist，产物给 tauri 编译期嵌入 ----
          # 排除与前端构建无关的目录，避免无谓的重build（src-tauri 改动不该
          # 触发前端重编，反之亦然）。
          frontendSrc = lib.cleanSourceWith {
            src = self;
            filter = path: type:
              let
                excludedDirs = [
                  ".git" "node_modules" "dist" "dist-ssr" ".agentenv"
                  "src-tauri" "target" ".github" "doc" "usability" "scripts" ".trae"
                ];
              in
              !lib.elem (lib.baseNameOf path) excludedDirs
              && !lib.hasSuffix ".md" path;
          };

          frontend = pkgs.buildNpmPackage {
            pname = "reelfs-frontend";
            version = "0.1.0";
            src = frontendSrc;
            nodejs = node;
            # hash 算法：nix build .#frontend 报错时会给出正确的 got: sha256-...
            # 受限网络（registry.npmjs.org 不可达）时：写一个包含
            # npmRegistryOverridesString 的 nixpkgs config 文件，
            # NIXPKGS_CONFIG=<该文件> nix build --impure .#frontend 走镜像；
            # 注意镜像需已同步 lockfile 里的所有版本，仓库本身保持纯净。
            npmDepsHash = lib.fakeHash;
            installPhase = ''
              runHook preInstall
              cp -r dist $out
              runHook postInstall
            '';
          };

          # ---- Rust/Tauri 应用 ----
          # tauri-build 在编译期读 tauri.conf.json / capabilities/ / icons/，
          # 而 crane 默认的 cargo 源码过滤会把它们滤掉 —— 这里补回来。
          rustSrc = lib.cleanSourceWith {
            src = ./src-tauri;
            filter = path: type:
              craneLib.filterCargoSources path type
              || lib.elem (lib.baseNameOf path) [ "tauri.conf.json" ]
              || lib.hasInfix "/icons" path
              || lib.hasInfix "/capabilities" path;
          };

          commonArgs = {
            src = rustSrc;
            strictDeps = true;
            nativeBuildInputs = [ pkgs.pkg-config ]
              ++ lib.optionals isLinux [ pkgs.wrapGAppsHook3 ];
            buildInputs = lib.optionals isLinux linuxGtk;
          };

          reelfs = craneLib.buildPackage (commonArgs // {
            cargoArtifacts = craneLib.buildDepsOnly commonArgs;

            # tauri CLI 的 beforeBuildCommand（npm run build）在 nix 里由上面的
            # frontend derivation 替代；custom-protocol = 编译期嵌入 dist 资产，
            # 而不是连 devUrl。dist 放到 src-tauri/../dist（tauri.conf.json 的
            # frontendDist 指向的位置）。
            buildPhaseCargoCommand = "cargoBuildLog=cargoBuildLog.json; cargo build --release --offline --features custom-protocol --message-format json-render-diagnostics >$cargoBuildLog";
            preBuild = ''
              mkdir -p ../dist
              cp -r ${frontend}/. ../dist/
            '';

            # 测试由 dev shell 的 gate（cargo test）负责，打包保持精简
            doCheck = false;

            meta.mainProgram = "reelfs";
          } // lib.optionalAttrs isLinux {
            # 运行时带上 schema（dev shell 里对应 GSETTINGS_SCHEMA_DIR），
            # wrapGAppsHook 把它写进启动 wrapper
            gappsWrapperArgs = [
              "--set GSETTINGS_SCHEMA_DIR ${lib.concatStringsSep ":" schemaDirs}"
            ];
          });
          # 本地离线验证用：不跑 npm，直接吃本机已构建的 dist/（vite 产物）。
          # 用法：`npm run build && REELFS_LOCAL_DIST=$PWD/dist nix build --impure .#reelfs-local`。
          # 纯求值（CI / flake check）下 getEnv 为空，这个出口不可见，不影响 .#reelfs。
          localDist = builtins.getEnv "REELFS_LOCAL_DIST";
        in
        {
          devShell = pkgs.mkShell ({
            nativeBuildInputs = lib.optionals isLinux [ pkgs.pkg-config ] ++ rust ++ [ node ];
            buildInputs = lib.optionals isLinux linuxGtk;

          # 沙盒样本媒体生成（scripts/agent-env.sh）用；顺带避免脚本再走 nix 回退。
          # python3 是共享测试数据集的物化器（scripts/gen-testdata.py），
          # cargo test 的 fixture_tests 也会调用它 —— dev shell 必须自带。
          packages = [ pkgs.ffmpeg pkgs.python3 ];

            # rust-analyzer 需要 std 源码
            RUST_SRC_PATH = "${pkgs.rustPlatform.rustLibSrc}";
          } // lib.optionalAttrs isLinux {
            GSETTINGS_SCHEMA_DIR = lib.concatStringsSep ":" schemaDirs;
          });

          inherit frontend reelfs;
        } // lib.optionalAttrs (localDist != "") {
          reelfs-local = craneLib.buildPackage (commonArgs // {
            cargoArtifacts = craneLib.buildDepsOnly commonArgs;
            buildPhaseCargoCommand = "cargoBuildLog=cargoBuildLog.json; cargo build --release --offline --features custom-protocol --message-format json-render-diagnostics >$cargoBuildLog";
            preBuild = ''
              mkdir -p ../dist
              cp -r ${builtins.path { path = localDist; name = "reelfs-dist-local"; }}/. ../dist/
            '';
            doCheck = false;
            meta.mainProgram = "reelfs";
          });
        });
    in
    {
      devShells = lib.mapAttrs (_: v: { default = v.devShell; }) perSystem;
      packages = lib.mapAttrs (_: v: {
        inherit (v) frontend reelfs;
        default = v.reelfs;
      } // lib.optionalAttrs (v ? reelfs-local) { inherit (v) reelfs-local; }) perSystem;
    };
}
