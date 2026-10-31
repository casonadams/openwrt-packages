#!/bin/sh
# Integration test: the real engine against the real uci and nft binaries. Run inside an
# OpenWrt rootfs container with NET_ADMIN (see .github/workflows/build.yml):
#   docker run --rm --cap-add NET_ADMIN -v "$PWD:/w" -w /w openwrt/rootfs:x86-64-24.10.2 \
#     sh tests/test_integration.sh
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=tests/lib.sh
. "$SCRIPT_DIR/lib.sh"
PKG="$REPO_ROOT/luci-app-screentime"

for tool in uci nft; do
	command -v "$tool" >/dev/null 2>&1 || { echo "$tool not found; run inside an OpenWrt container" >&2; exit 1; }
done

TEST_TMP=$(mktemp -d)
cleanup() {
	nft delete table inet screentime 2>/dev/null
	rm -rf "$TEST_TMP"
}
trap cleanup EXIT

sed '/^case "\$1" in/,$d' "$PKG/root/usr/bin/screentime" > "$TEST_TMP/harness.sh"
export SCREENTIME_DECIDE="$PKG/root/usr/share/screentime/decide.awk"
export UCI_CONFIG_DIR="$TEST_TMP/config"
export OVERRIDE_FILE="$TEST_TMP/override"
export STATE_FILE="$TEST_TMP/blocked"
export LOCK_DIR="$TEST_TMP/lock"
export LEASES_FILE="$TEST_TMP/leases"
mkdir -p "$UCI_CONFIG_DIR"

# The three option/list spellings seen in the wild, plus anonymous sections
cat > "$UCI_CONFIG_DIR/screentime" <<'CFG'
config settings 'settings'
	option enabled '1'

config schedule 'evening'
	option weekdays 'mon tue wed thu sun'
	option start_time '18:00:00'
	option duration '150'
	option devices 'all'

config schedule
	list weekdays 'fri'
	list weekdays 'sat'
	option start_time '6:00 PM'
	option duration '240'
	list devices 'all'

config device 'tv'
	option name 'Living Room TV'
	option mac '00:00:5e:00:53:01'

config device
	option name 'Bedroom Tablet'
	option mac '00:00:5e:00:53:02'
CFG
TV=00:00:5e:00:53:01
TABLET=00:00:5e:00:53:02

# shellcheck source=/dev/null
. "$TEST_TMP/harness.sh"

echo "-> Real uci parsing"
at mon 18 30; assert_eq "option weekdays, window open" allowed "$(state $TV)"
at fri 19 0;  assert_eq "list weekdays + 12h time, window open" allowed "$(state $TV)"
at fri 17 0;  assert_eq "list weekdays, before window" blocked "$(state $TV)"
at sat 10 0;  assert_eq "anonymous device is managed" blocked "$(state $TABLET)"

echo "-> Real nft"
at mon 17 0
reconcile
assert_eq "ruleset loads in the kernel" yes "$(nft list table inet screentime >/dev/null 2>&1 && echo yes)"
assert_eq "blocked set holds both devices" 2 "$(nft list set inet screentime blocked | grep -o -E '([0-9a-f]{2}:){5}[0-9a-f]{2}' | wc -l | tr -d ' ')"
assert_eq "forward hook runs before fw4 (priority -1)" yes "$(nft list chain inet screentime forward | grep -q 'priority filter - 1' && echo yes)"
at mon 18 30
reconcile
assert_eq "window open: set is empty" 0 "$(nft list set inet screentime blocked | grep -c -E '([0-9a-f]{2}:){5}[0-9a-f]{2}')"
at mon 17 0
reconcile
assert_eq "window closed: set refilled" 2 "$(nft list set inet screentime blocked | grep -o -E '([0-9a-f]{2}:){5}[0-9a-f]{2}' | wc -l | tr -d ' ')"
cmd_teardown
assert_eq "teardown removes the table" no "$(nft list table inet screentime >/dev/null 2>&1 && echo yes || echo no)"

summary
