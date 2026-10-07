# Reelfs - NAS Local Movie Browser

A lightweight, fast, cross-platform movie browser for your NAS library.

## Features

- ✅ Fast SQLite-based indexing
- ✅ Support for 10,000+ movies
- ✅ Virtual scrolling for smooth performance
- ✅ Full-text search
- ✅ Automatic thumbnail generation
- ✅ Real-time file system monitoring
- ✅ System player integration
- ✅ Play history and resume functionality
- ✅ Cross-platform (macOS + Linux/NixOS)

## Tech Stack

- **Frontend**: React 18 + TypeScript + Tailwind CSS
- **Backend**: Rust + Tauri
- **Database**: SQLite with FTS5
- **Virtual Scrolling**: react-window
- **State Management**: Zustand

## Getting Started

### Prerequisites

- Rust (latest stable)
- Node.js 20.19+（或 22.12+，Vite 7 的 engines 要求）
- macOS or Linux

### Installation

```bash
# Install dependencies
npm install

# Run in development mode
npm run tauri:dev

# Build for production
npm run tauri:build
```

### Configuration

1. Launch the app
2. Go to Settings
3. Add your NAS mount paths (e.g., `/Volumes/NAS/Movies` or `/mnt/nas/movies`)
4. Click "Start Full Scan"
5. Wait for the initial indexing to complete

## Architecture

The app consists of:

- **Indexer**: Scans directories, parses .nfo files
- **Database**: SQLite with FTS5 for fast full-text search
- **Watcher**: Monitors file system changes for incremental updates
- **Thumbnail Generator**: Creates WebP thumbnails for fast loading
- **Player Integration**: Calls system player (mpv/open/xdg-open)

## Performance

- **Startup Time**: < 300ms
- **UI Framerate**: 60 FPS with virtual scrolling
- **Search Response**: < 100ms
- **Memory Usage**: < 200MB
- **App Size**: < 20MB

## Project Structure

```
reelfs/
├── src/                  # React frontend
│   ├── pages/           # Page components
│   ├── components/      # Reusable components
│   ├── stores/          # Zustand state management
│   └── services/        # Tauri API wrappers
├── src-tauri/           # Rust backend
│   └── src/
│       ├── database.rs  # SQLite operations
│       ├── indexer.rs   # Directory scanning & NFO parsing
│       ├── thumbnail.rs # Image processing
│       ├── watcher.rs   # File system monitoring
│       ├── player.rs    # Player integration
│       └── models.rs    # Data structures
└── README.md
```

## License

MIT

## Author

Built with ❤️ for movie enthusiasts
