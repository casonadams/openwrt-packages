#!/bin/sh
set -e

# Test suite for screentime backend engine
FAILED=0
PASSED=0

assert_eq() {
	desc="$1"
	expected="$2"
	actual="$3"
	if [ "$expected" = "$actual" ]; then
		printf "  ✓ %s\n" "$desc"
		PASSED=$((PASSED + 1))
	else
		printf "  ✗ %s (expected: '%s', got: '%s')\n" "$desc" "$expected" "$actual"
		FAILED=$((FAILED + 1))
	fi
}

echo "=========================================="
echo " Running screentime test suite"
echo "=========================================="

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENGINE="$REPO_ROOT/luci-app-screentime/root/usr/bin/screentime"

if [ ! -f "$ENGINE" ]; then
	echo "Error: Engine script not found at $ENGINE" >&2
	exit 1
fi

TEST_TMP=$(mktemp -d)
trap 'rm -rf "$TEST_TMP"' EXIT

# Extract logic functions into a testable harness
sed '/^case "\$1" in/,$d' "$ENGINE" > "$TEST_TMP/harness.sh"
# Override UCI commands for isolated unit testing
cat << 'EOF' >> "$TEST_TMP/harness.sh"
uci() {
	case "$1" in
		-q) shift ;;
	esac
	cmd="$1"; shift
	case "$cmd" in
		get)
			case "$1" in
				screentime.settings.enabled) echo "1" ;;
				screentime.schedule_a.enabled) echo "1" ;;
				screentime.schedule_a.start_time) echo "18:00:00" ;;
				screentime.schedule_a.duration) echo "90" ;;
				screentime.schedule_a.stop_time) echo "19:30:00" ;;
				screentime.schedule_a.weekdays) echo "all" ;;
				system.@system[0].zonename) echo "America/Denver" ;;
				*) return 1 ;;
			esac
			;;
		show)
			case "$1" in
				screentime)
					echo "screentime.settings=settings"
					echo "screentime.schedule_a=schedule"
					echo "screentime.dev_1=device"
					;;
				*) return 1 ;;
			esac
			;;
		*) return 0 ;;
	esac
}
fw4() { return 0; }
conntrack() { return 0; }
EOF

# shellcheck source=/dev/null
. "$TEST_TMP/harness.sh"

echo "-> Testing parse_time function..."
assert_eq "Standard 24h format" "18:00:00" "$(parse_time '18:00:00')"
assert_eq "24h format without seconds" "18:00:00" "$(parse_time '18:00')"
assert_eq "12h format PM with minutes" "19:30:00" "$(parse_time '7:30pm')"
assert_eq "12h format PM uppercase with space" "19:30:00" "$(parse_time ' 7:30 PM ')"
assert_eq "12h format 12pm (noon)" "12:00:00" "$(parse_time '12:00pm')"
assert_eq "12h format 12am (midnight)" "00:00:00" "$(parse_time '12:00am')"
assert_eq "12h format morning" "08:15:00" "$(parse_time '8:15am')"

echo "-> Testing calc_stop_time function..."
assert_eq "Same day duration addition" "19:30:00" "$(calc_stop_time '18:00:00' 90)"
assert_eq "Hour crossing" "19:15:00" "$(calc_stop_time '18:30:00' 45)"
assert_eq "Midnight rollover" "01:00:00" "$(calc_stop_time '23:00:00' 120)"

echo "-> Testing weekday_to_cron function..."
assert_eq "Sunday" "0" "$(weekday_to_cron 'sun')"
assert_eq "Monday" "1" "$(weekday_to_cron 'Mon')"
assert_eq "Tuesday" "2" "$(weekday_to_cron 'tue')"
assert_eq "Wednesday" "3" "$(weekday_to_cron 'wed')"
assert_eq "Thursday" "4" "$(weekday_to_cron 'thu')"
assert_eq "Friday" "5" "$(weekday_to_cron 'fri')"
assert_eq "Saturday" "6" "$(weekday_to_cron 'sat')"
assert_eq "All weekdays wildcard" "*" "$(weekday_to_cron 'all')"

echo "-> Testing override state management..."
OVERRIDE_FILE="$TEST_TMP/override"
assert_eq "Default override state is none" "none" "$(get_override_state)"
echo "ignore_downtime" > "$OVERRIDE_FILE"
assert_eq "Reads ignore_downtime override" "ignore_downtime" "$(get_override_state)"
echo "forced_downtime" > "$OVERRIDE_FILE"
assert_eq "Reads forced_downtime override" "forced_downtime" "$(get_override_state)"
echo "invalid_value" > "$OVERRIDE_FILE"
assert_eq "Rejects invalid override values" "none" "$(get_override_state)"
rm -f "$OVERRIDE_FILE"

echo "-> Testing JSON configuration contracts..."
node -e '
const fs = require("fs");
const menu = JSON.parse(fs.readFileSync("luci-app-screentime/root/usr/share/luci/menu.d/luci-app-screentime.json", "utf8"));
if (!menu["admin/services/screentime"]) throw new Error("Missing menu entry");
if (menu["admin/services/screentime"].action.type !== "view") throw new Error("Invalid menu action type");

const acl = JSON.parse(fs.readFileSync("luci-app-screentime/root/usr/share/rpcd/acl.d/luci-app-screentime.json", "utf8"));
if (!acl["luci-app-screentime"]) throw new Error("Missing ACL root");
const readAcl = acl["luci-app-screentime"].read;
const writeAcl = acl["luci-app-screentime"].write;
if (!readAcl.uci.includes("screentime")) throw new Error("Missing UCI read ACL");
if (!writeAcl.uci.includes("screentime")) throw new Error("Missing UCI write ACL");
if (!writeAcl.file["/usr/bin/screentime"]) throw new Error("Missing file exec ACL");
' && printf "  ✓ LuCI menu and RPCD ACL contracts valid\n" && PASSED=$((PASSED + 1))

echo "=========================================="
echo " Results: $PASSED passed, $FAILED failed"
echo "=========================================="

[ "$FAILED" -eq 0 ]
