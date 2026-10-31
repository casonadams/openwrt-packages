#!/bin/sh
# Install a package from the casonadams/openwrt-packages feed on OpenWrt 25+.
#   wget -qO- https://raw.githubusercontent.com/casonadams/openwrt-packages/main/install.sh | sh -s -- [package]
set -e

PKG="${1:-luci-app-screentime}"
FEED_URL="https://casonadams.github.io/openwrt-packages/packages.adb"
FEED_FILE="/etc/apk/repositories.d/casonadams.list"

[ -f /etc/openwrt_release ] || { echo "Error: this script must run on OpenWrt." >&2; exit 1; }
command -v apk >/dev/null 2>&1 || { echo "Error: apk not found (OpenWrt 25+ required)." >&2; exit 1; }

echo "--> Adding package feed..."
echo "$FEED_URL" > "$FEED_FILE"
apk update --allow-untrusted
apk add --allow-untrusted "$PKG"

# The package's post-install script enables the service; refresh LuCI so the new view appears.
rm -rf /tmp/luci-* /var/luci-* 2>/dev/null || true
[ -x /etc/init.d/rpcd ] && /etc/init.d/rpcd reload

echo "Installed ${PKG}."
