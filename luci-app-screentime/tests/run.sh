#!/bin/sh
# Run every suite for this package. The integration suite needs docker and is skipped without it.
cd "$(dirname "$0")/.." || exit 1

sh tests/test_engine.sh || exit 1
node tests/test_ui.js || exit 1

if command -v docker >/dev/null 2>&1; then
	docker run --rm --cap-add NET_ADMIN -v "$PWD:/w" -w /w \
		openwrt/rootfs:x86-64-24.10.2 sh tests/test_integration.sh || exit 1
else
	echo "docker not found: skipping tests/test_integration.sh"
fi
