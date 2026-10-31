#!/bin/sh
# Build APKv3 packages and a repository index.
#
#   ./scripts/build-apk.sh [package ...]    default: every top-level directory with a Makefile
#
# Version comes from <package>/version.txt (maintained by release-please); VERSION overrides it
# when exactly one package is built. Output goes to $OUTPUT_DIR (default: dist/).
set -e

OUTPUT_DIR="${OUTPUT_DIR:-dist}"

if [ "$#" -eq 0 ]; then
	for mk in */Makefile; do set -- "$@" "${mk%/Makefile}"; done
fi

if ! command -v apk >/dev/null 2>&1 || ! apk --help 2>&1 | grep -q mkpkg; then
	if command -v docker >/dev/null 2>&1; then
		echo "apk mkpkg not found locally; building inside an alpine:edge container..."
		exec docker run --rm -v "$(pwd):/work" -w /work \
			-e VERSION="${VERSION:-}" -e OUTPUT_DIR="$OUTPUT_DIR" \
			-e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" \
			alpine:edge ./scripts/build-apk.sh "$@"
	fi
	echo "Error: apk mkpkg or docker is required to build OpenWrt APKv3 packages." >&2
	exit 1
fi

# OpenWrt revision format: 1.0.0 -> 1.0.0-r1
pkg_version() {
	if [ -n "$VERSION" ] && [ "$SINGLE" = 1 ]; then raw=$VERSION; else raw=$(cat "$1/version.txt"); fi
	raw=${raw#v}
	case "$raw" in *-r*) echo "$raw" ;; *) echo "${raw}-r1" ;; esac
}

# makefile_var <package> <VAR>: value of VAR:=... in the package Makefile
makefile_var() {
	sed -n "s/^$2:=//p" "$1/Makefile"
}

build_one() {
	pkg=$1
	[ -d "$pkg" ] || { echo "Error: package directory '$pkg' not found." >&2; exit 1; }
	version=$(pkg_version "$pkg")
	echo "Building ${pkg} ${version}..."

	staging="/tmp/pkg_staging_${pkg}"
	rm -rf "$staging"
	mkdir -p "$staging/www" "$OUTPUT_DIR"
	cp -r "$pkg/root/." "$staging/"
	cp -r "$pkg/htdocs/." "$staging/www/"
	for dir in etc/init.d etc/uci-defaults etc/hotplug.d usr/bin; do
		[ -d "$staging/$dir" ] && find "$staging/$dir" -type f -exec chmod +x {} +
	done

	scripts=""
	for s in postinst:post-install postinst:post-upgrade prerm:pre-deinstall; do
		[ -f "$pkg/${s%%:*}" ] && scripts="$scripts --script ${s##*:}:$pkg/${s%%:*}"
	done

	# shellcheck disable=SC2086
	apk mkpkg \
		--files "$staging" \
		--info name:"$pkg" \
		--info version:"$version" \
		--info description:"$(makefile_var "$pkg" LUCI_TITLE)" \
		--info arch:"noarch" \
		--info license:"$(makefile_var "$pkg" PKG_LICENSE)" \
		--info url:"https://github.com/casonadams/openwrt-packages" \
		--info depends:"libc luci-base $(makefile_var "$pkg" LUCI_DEPENDS | tr -d '+')" \
		$scripts \
		--output "$OUTPUT_DIR/${pkg}-${version}.apk"
	cp -f "$OUTPUT_DIR/${pkg}-${version}.apk" "$OUTPUT_DIR/${pkg}.apk"
	rm -rf "$staging"
	BUILT="$BUILT $OUTPUT_DIR/${pkg}-${version}.apk"
}

BUILT=""
SINGLE=0
[ "$#" -eq 1 ] && SINGLE=1
for pkg in "$@"; do
	build_one "$pkg"
done

echo "Generating repository index packages.adb..."
# shellcheck disable=SC2086
apk mkndx --allow-untrusted --output "$OUTPUT_DIR/packages.adb" $BUILT
ls -lh "$OUTPUT_DIR"

# The container runs as root; hand the output back to the invoking user.
if [ -n "${HOST_UID:-}" ]; then
	chown -R "${HOST_UID}:${HOST_GID:-$HOST_UID}" "$OUTPUT_DIR"
fi
