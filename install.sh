#!/bin/bash

# --- CONFIGURATION ---
# Replace this URL with your actual GitHub Release download link once you upload it
DOWNLOAD_URL="YOUR_GITHUB_RELEASE_ZIP_URL"
APP_NAME="Local Transfer"
ZIP_NAME="Local-Transfer-mac.zip"

echo "🚀 Starting installation of $APP_NAME..."

# 1. Create a temp directory
mkdir -p /tmp/local_transfer_install
cd /tmp/local_transfer_install

# 2. Download the app
echo "📥 Downloading app from cloud..."
# Using -L to follow redirects (common for GitHub)
curl -L -o "$ZIP_NAME" "$DOWNLOAD_URL"

if [ $? -ne 0 ]; then
    echo "❌ Error: Failed to download the file. Please check the URL."
    exit 1
fi

# 3. Unzip
echo "📦 Unpacking..."
unzip -q "$ZIP_NAME"

# 4. Move to Applications folder
echo "🚚 Moving to Applications folder..."
# Check if it already exists and remove old version
if [ -d "/Applications/$APP_NAME.app" ]; then
    echo "♻️ Replacing existing version..."
    rm -rf "/Applications/$APP_NAME.app"
fi

# Move the .app file
mv "$APP_NAME.app" /Applications/

# 5. Cleanup
echo "🧹 Cleaning up temp files..."
cd ~
rm -rf /tmp/local_transfer_install

echo "✅ Done! $APP_NAME is now in your Applications folder."
echo "👉 You can now delete the source code folder and just run the app from your Launchpad!"
