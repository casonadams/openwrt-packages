#!/bin/sh
set -e

# OpenWrt Package Installer for luci-app-screentime
REPO="casonadams/openwrt-packages"
PKG="${1:-luci-app-screentime}"
DOWNLOAD_URL="https://github.com/${REPO}/releases/latest/download/${PKG}.apk"
TMP_APK="/tmp/${PKG}.apk"

echo "=================================================="
echo " Installing ${PKG} on OpenWrt"
echo "=================================================="

# Check for OpenWrt environment
if [ ! -f /etc/openwrt_release ]; then
	echo "Error: /etc/openwrt_release not found. This script must run on OpenWrt." >&2
	exit 1
fi

# Check for apk package manager
if ! command -v apk >/dev/null 2>&1; then
	echo "Error: apk package manager not found." >&2
	echo "This package requires OpenWrt 25+ (or 24.10 with apk enabled)." >&2
	exit 1
fi

# Download latest APK
echo "--> Downloading latest ${PKG} from GitHub Releases..."
if command -v curl >/dev/null 2>&1; then
	curl -f -sSL -o "$TMP_APK" "$DOWNLOAD_URL"
elif command -v wget >/dev/null 2>&1; then
	wget -q -O "$TMP_APK" "$DOWNLOAD_URL"
elif command -v uclient-fetch >/dev/null 2>&1; then
	uclient-fetch -O "$TMP_APK" "$DOWNLOAD_URL"
else
	echo "Error: Neither curl, wget, nor uclient-fetch is available." >&2
	exit 1
fi

if [ ! -s "$TMP_APK" ]; then
	echo "Error: Failed to download ${PKG}.apk from ${DOWNLOAD_URL}" >&2
	rm -f "$TMP_APK"
	exit 1
fi

# Install the APK
echo "--> Installing ${PKG} via apk add..."
apk add --allow-untrusted "$TMP_APK"
rm -f "$TMP_APK"

# Flush LuCI caches and restart rpcd
echo "--> Refreshing LuCI runtime and rpcd service..."
rm -rf /tmp/luci-* /var/luci-* 2>/dev/null || true
if [ -x /etc/init.d/rpcd ]; then
	/etc/init.d/rpcd restart
fi

# Enable and start the service if it has an init script
INIT_SCRIPT="/etc/init.d/${PKG#luci-app-}"
if [ -x "$INIT_SCRIPT" ]; then
	"$INIT_SCRIPT" enable 2>/dev/null || true
	"$INIT_SCRIPT" start 2>/dev/null || true
fi

echo ""
echo "=================================================="
echo " Successfully installed ${PKG}!"
echo " Access in LuCI Web UI: Services -> Screen Time"
echo "=================================================="
