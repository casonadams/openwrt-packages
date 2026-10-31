#!/bin/sh
set -e

# Package metadata
PKG="${1:-luci-app-screentime}"
RAW_VERSION="${VERSION:-$(cat version.txt 2>/dev/null || echo "1.0.0")}"
# Strip leading 'v' if present
CLEAN_VERSION="${RAW_VERSION#v}"
# Ensure OpenWrt revision format (e.g. 1.0.0 -> 1.0.0-r1)
case "$CLEAN_VERSION" in
	*-r*) VERSION="$CLEAN_VERSION" ;;
	*)    VERSION="${CLEAN_VERSION}-r1" ;;
esac

OUTPUT_DIR="${OUTPUT_DIR:-dist}"

if ! command -v apk >/dev/null 2>&1 || ! apk --help 2>&1 | grep -q mkpkg; then
	if command -v docker >/dev/null 2>&1; then
		echo "apk mkpkg not found locally; executing build inside alpine:edge container..."
		exec docker run --rm -v "$(pwd):/work" -w /work \
			-e VERSION="$VERSION" -e OUTPUT_DIR="$OUTPUT_DIR" \
			-e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" \
			alpine:edge ./scripts/build-apk.sh "$PKG"
	else
		echo "Error: apk mkpkg or docker is required to build OpenWrt APKv3 packages." >&2
		exit 1
	fi
fi

if [ ! -d "$PKG" ]; then
	echo "Error: Package directory '$PKG' not found." >&2
	exit 1
fi

echo "Building APKv3 package: ${PKG} (${VERSION})..."

STAGING="/tmp/pkg_staging_${PKG}"
rm -rf "$STAGING"
mkdir -p "$OUTPUT_DIR"
mkdir -p "$STAGING/www"

# Copy package payload files
cp -r "$PKG/root/." "$STAGING/"
cp -r "$PKG/htdocs/." "$STAGING/www/"

# Set executable bits
chmod +x "$STAGING/etc/init.d/"* "$STAGING/etc/uci-defaults/"* "$STAGING/etc/hotplug.d/ntp/"* "$STAGING/usr/bin/"*

# Build official APKv3 ADB package
OUT_FILE="${OUTPUT_DIR}/${PKG}_${VERSION}_noarch.apk"
apk mkpkg \
  --files "$STAGING" \
  --info name:"$PKG" \
  --info version:"$VERSION" \
  --info description:"LuCI Web UI and backend engine for Screen Time & Parental Controls" \
  --info arch:"noarch" \
  --info license:"Apache-2.0" \
  --info url:"https://github.com/casonadams/openwrt-packages" \
  --info depends:"conntrack libc luci-base" \
  --script post-install:"$PKG/postinst" \
  --script post-upgrade:"$PKG/postinst" \
  --script pre-deinstall:"$PKG/prerm" \
  --output "$OUT_FILE"

rm -rf "$STAGING"

# Create filenames for releases and APK repository feed
REPO_FILE="${OUTPUT_DIR}/${PKG}-${VERSION}.apk"
cp -f "$OUT_FILE" "$REPO_FILE"
cp -f "$OUT_FILE" "${OUTPUT_DIR}/${PKG}.apk"
cp -f "$OUT_FILE" "${OUTPUT_DIR}/${PKG}_noarch.apk"

# Generate APKv3 repository index (packages.adb) for OpenWrt 25+
echo "Generating repository index packages.adb..."
apk mkndx --allow-untrusted --output "${OUTPUT_DIR}/packages.adb" "$REPO_FILE"

echo "Package and repository index successfully generated:"
ls -lh "${OUTPUT_DIR}"

# The container runs as root so apk records root-owned payload files; hand the
# build output back to the invoking user so later host-side steps can write to it.
if [ -n "${HOST_UID:-}" ]; then
	chown -R "${HOST_UID}:${HOST_GID:-$HOST_UID}" "$OUTPUT_DIR"
fi
