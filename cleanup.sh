#!/bin/bash
# Auto cleanup script for Rust projects

echo "🧹 Cleaning Rust build artifacts..."

# Clean current project
if [ -f "Cargo.toml" ]; then
    echo "Cleaning $(pwd)..."
    cargo clean
    
    # Remove only debug artifacts, keep release
    if [ -d "target/debug" ]; then
        rm -rf target/debug
        echo "  ✅ Removed target/debug"
    fi
    
    # Clean incremental compilation files
    if [ -d "target/.rustc_info.json" ]; then
        rm -f target/.rustc_info.json
    fi
    
    # Clean old deps in debug
    find target -name "*debug*" -type d -exec rm -rf {} + 2>/dev/null || true
fi

# Clean cargo cache globally (optional)
if command -v cargo-cache &> /dev/null; then
    echo "Cleaning cargo cache..."
    cargo-cache --autoclean-expensive
else
    echo "💡 Install cargo-cache for better cleanup: cargo install cargo-cache"
fi

echo "✨ Cleanup complete!"

# Show current sizes
if [ -d "target" ]; then
    echo "📊 Current target size: $(du -sh target | cut -f1)"
fi