#!/bin/sh
# Test suite for the screentime engine (engine functions + decide.awk), run with a faked
# clock, UCI dump, nft, conntrack and ip. Requires sh, awk and node.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=tests/lib.sh
. "$SCRIPT_DIR/lib.sh"
PKG="$REPO_ROOT/luci-app-screentime"
ENGINE="$PKG/root/usr/bin/screentime"

TEST_TMP=$(mktemp -d)
trap 'rm -rf "$TEST_TMP"' EXIT

# Engine functions without the command dispatcher
sed '/^case "\$1" in/,$d' "$ENGINE" > "$TEST_TMP/harness.sh"
export SCREENTIME_DECIDE="$PKG/root/usr/share/screentime/decide.awk"
export OVERRIDE_FILE="$TEST_TMP/override"
export STATE_FILE="$TEST_TMP/blocked"
export LOCK_DIR="$TEST_TMP/lock"
export LEASES_FILE="$TEST_TMP/leases"
CALLS="$TEST_TMP/calls"

cat > "$TEST_TMP/fixture" <<'EOF'
screentime.settings=settings
screentime.settings.enabled='1'
screentime.schedule_a=schedule
screentime.schedule_a.enabled='1'
screentime.schedule_a.weekdays='mon' 'tue' 'wed' 'thu' 'sun'
screentime.schedule_a.start_time='18:00:00'
screentime.schedule_a.duration='150'
screentime.schedule_a.devices='all'
screentime.@schedule[1]=schedule
screentime.@schedule[1].weekdays='fri sat'
screentime.@schedule[1].start_time='6:00 PM'
screentime.@schedule[1].duration='240'
screentime.@schedule[2]=schedule
screentime.@schedule[2].weekdays='sun'
screentime.@schedule[2].start_time='23:00:00'
screentime.@schedule[2].duration='120'
screentime.@schedule[2].devices='00:00:5e:00:53:02'
screentime.@schedule[3]=schedule
screentime.@schedule[3].enabled='0'
screentime.@schedule[3].start_time='00:00:00'
screentime.@schedule[3].duration='1440'
screentime.dev_tv=device
screentime.dev_tv.name='Living Room TV'
screentime.dev_tv.mac='00:00:5e:00:53:01'
screentime.@device[1]=device
screentime.@device[1].name='Bedroom Tablet'
screentime.@device[1].mac='00:00:5e:00:53:02'
screentime.@device[2]=device
screentime.@device[2].mac='aa:bb:cc:dd:ee:ff'
screentime.@device[2].enabled='0'
screentime.@device[3]=device
screentime.@device[3].mac='not-a-mac'
EOF
TV=00:00:5e:00:53:01
TABLET=00:00:5e:00:53:02

cat >> "$TEST_TMP/harness.sh" <<EOF
config_dump() { cat "\$TEST_TMP/fixture"; }
nft() {
	case "\$1" in
		list) [ -f "\$TEST_TMP/table" ]; return ;;
		delete) rm -f "\$TEST_TMP/table"; return ;;
	esac
	echo "nft apply" >> "\$CALLS"
	cat > "\$TEST_TMP/table"
}
conntrack() { echo "conntrack \$*" >> "\$CALLS"; }
ip() { echo "10.0.0.5 dev br-lan lladdr $TV REACHABLE"; echo "fd00::5 dev br-lan lladdr $TV STALE"; }
sleep() { :; }
uci() { return 1; }
EOF
export TEST_TMP CALLS
# shellcheck source=/dev/null
. "$TEST_TMP/harness.sh"

echo "-> Window evaluation (decide.awk)"
at mon 17 59; assert_eq "Mon 17:59 blocked before window" blocked "$(state $TV)"
at mon 18 0;  assert_eq "Mon 18:00 allowed at window start" allowed "$(state $TV)"
at mon 20 29; assert_eq "Mon 20:29 allowed inside 2h30 window" allowed "$(state $TV)"
at mon 20 30; assert_eq "Mon 20:30 blocked at window end" blocked "$(state $TV)"
at fri 6 0;   assert_eq "Fri 06:00 blocked (window is evening)" blocked "$(state $TV)"
at fri 21 59; assert_eq "Fri 21:59 allowed (12h clock start, 4h window)" allowed "$(state $TV)"
at sat 10 14; assert_eq "Sat 10:14 blocked" blocked "$(state $TV)"
at sat 19 0;  assert_eq "Sat 19:00 allowed" allowed "$(state $TV)"
at tue 12 0;  assert_eq "disabled all-day schedule is ignored" blocked "$(state $TV)"
at sun 23 30; assert_eq "device-scoped late window allows its device" allowed "$(state $TABLET)"
at sun 23 30; assert_eq "device-scoped late window does not allow others" blocked "$(state $TV)"
at mon 0 59;  assert_eq "midnight-crossing window spills into Monday" allowed "$(state $TABLET)"
at mon 1 0;   assert_eq "midnight-crossing window ends at 01:00" blocked "$(state $TABLET)"
at sat 23 30; assert_eq "window does not repeat the day before its start" blocked "$(state $TABLET)"
at mon 18 0;  assert_eq "disabled device is not managed" "" "$(state aa:bb:cc:dd:ee:ff)"
at mon 18 0;  assert_eq "invalid MAC is not managed" "" "$(state not-a-mac)"
at mon 18 0;  assert_eq "uppercase MAC is normalised" allowed "$(state $TV)"

echo "-> Next change"
at mon 17 0
assert_eq "Blocked device: window opens in 1h" 3600 "$(load_state; decide lines | awk -F'|' -v m=$TV '$2 == m {print $5}')"
at mon 18 30
assert_eq "Allowed device: window closes in 2h" 7200 "$(load_state; decide lines | awk -F'|' -v m=$TV '$2 == m {print $5}')"
at mon 17 0; unset OVR_MODE
assert_eq "Global next change matches" 3600 "$(load_state; decide lines | awk -F'|' '$1 == "G" {print $4}')"

echo "-> Master switch and no schedules"
cp "$TEST_TMP/fixture" "$TEST_TMP/fixture.orig"
sed "s/settings.enabled='1'/settings.enabled='0'/" "$TEST_TMP/fixture.orig" > "$TEST_TMP/fixture"
at sat 10 0; assert_eq "master switch off allows everything" allowed "$(state $TV)"
grep -v 'schedule' "$TEST_TMP/fixture.orig" | sed "s/'0'/'1'/" > "$TEST_TMP/fixture"
at mon 18 30; assert_eq "no schedules blocks 24/7" blocked "$(state $TV)"
assert_eq "no schedules: no next change" -1 "$(load_state; decide lines | awk -F'|' '$1 == "G" {print $4}')"
cp "$TEST_TMP/fixture.orig" "$TEST_TMP/fixture"

echo "-> JSON output"
at mon 18 30
decide_json() { load_state; decide json; }
decide_json > "$TEST_TMP/status.json"
node -e '
const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const tv = s.devices.find(d => d.mac === "00:00:5e:00:53:01");
const ok = s.in_window === 1 && s.override.mode === "none" && tv.allowed === true
	&& tv.name === "Living Room TV" && tv.change_at === s.now + 7200 && s.devices.length === 2;
process.exit(ok ? 0 : 1);
' "$TEST_TMP/status.json"
assert_eq "status --json is valid and consistent" 0 "$?"

echo "-> Override lifecycle"
rm -f "$OVERRIDE_FILE"
at sat 10 0
set_override ignore >/dev/null
assert_eq "ignore stored with expiry at next window open (Sat 18:00)" "ignore $((1800000000 + 18 * 3600))" "$(cat "$OVERRIDE_FILE")"
assert_eq "ignore allows a device in downtime" allowed "$(state $TV)"
at sat 17 59; assert_eq "ignore still active a minute before the window" allowed "$(state $TV)"
at sat 18 0; read_override "$((1800000000 + 18 * 3600))"
assert_eq "ignore expires exactly at window open" none "$OVR_MODE"
assert_eq "expired override file is removed" no "$([ -f "$OVERRIDE_FILE" ] && echo yes || echo no)"
at sat 19 0; assert_eq "schedule resumes after expiry" allowed "$(state $TV)"
at sat 20 0
set_override forced >/dev/null
assert_eq "forced stored with expiry at window close (Sat 22:00)" "forced $((1800000000 + 22 * 3600))" "$(cat "$OVERRIDE_FILE")"
assert_eq "forced blocks a device inside a window" blocked "$(state $TV)"
echo "bogus 123" > "$OVERRIDE_FILE"
at sat 20 0; read_override "$((1800000000 + 20 * 3600))"
assert_eq "unknown override mode is rejected" none "$OVR_MODE"
echo "ignore soon" > "$OVERRIDE_FILE"
read_override "$((1800000000 + 20 * 3600))"
assert_eq "non-numeric expiry is rejected" none "$OVR_MODE"
rm -f "$OVERRIDE_FILE"

echo "-> Reconcile (nft set and flow teardown)"
rm -f "$CALLS" "$STATE_FILE" "$TEST_TMP/table"
at mon 17 0
reconcile
assert_eq "downtime: both devices are in the blocked set" "$TV
$TABLET" "$(sort < "$STATE_FILE" | tr -s '\n' | sed '/^$/d')"
assert_eq "downtime: ruleset is a private table" yes "$(grep -q 'table inet screentime' "$TEST_TMP/table" && echo yes)"
assert_eq "downtime: set lists the blocked MACs" yes "$(grep -q "elements = { $TV, $TABLET }" "$TEST_TMP/table" && echo yes)"
assert_eq "first reconcile flushes IPv4 flows of blocked device" yes "$(grep -q 'conntrack -f ipv4 -D -s 10.0.0.5' "$CALLS" && echo yes)"
assert_eq "first reconcile flushes IPv6 flows of blocked device" yes "$(grep -q 'conntrack -f ipv6 -D -d fd00::5' "$CALLS" && echo yes)"
rm -f "$CALLS"
reconcile
assert_eq "unchanged state does not touch nft again" "" "$(cat "$CALLS" 2>/dev/null)"
at mon 18 0
reconcile
assert_eq "window open: blocked set is empty" "" "$(sed '/^$/d' "$STATE_FILE")"
assert_eq "window open: set has no elements" "" "$(grep elements "$TEST_TMP/table")"
rm -f "$CALLS"
at mon 20 30
reconcile
assert_eq "window close: blocked set refilled" yes "$(grep -q "elements = { $TV, $TABLET }" "$TEST_TMP/table" && echo yes)"
assert_eq "window close: flows of newly blocked device flushed" yes "$(grep -q 'conntrack -f ipv4 -D -s 10.0.0.5' "$CALLS" && echo yes)"
rm -f "$CALLS" "$TEST_TMP/table"
reconcile
assert_eq "missing table is recreated even if state unchanged" yes "$([ -f "$TEST_TMP/table" ] && echo yes)"
assert_eq "recreating the table does not flush flows" "nft apply" "$(cat "$CALLS")"
rm -f "$CALLS" "$STATE_FILE" "$TEST_TMP/table"
SCREENTIME_CLOCK="mon 100 1000"
reconcile
assert_eq "clock before NTP sync changes nothing" "" "$(cat "$CALLS" 2>/dev/null)$([ -f "$TEST_TMP/table" ] && echo table)"
assert_eq "lock is released after reconcile" no "$([ -d "$LOCK_DIR" ] && echo yes || echo no)"

echo "-> Teardown leaves nothing behind"
at mon 17 0
reconcile
mkdir "$LOCK_DIR"
cmd_teardown
assert_eq "teardown removes the state file" no "$([ -f "$STATE_FILE" ] && echo yes || echo no)"
assert_eq "teardown removes the nft table" no "$([ -f "$TEST_TMP/table" ] && echo yes || echo no)"
assert_eq "teardown removes a stale lock" no "$([ -d "$LOCK_DIR" ] && echo yes || echo no)"

echo "-> Helpers"
assert_eq "newly_blocked returns only additions" "b" "$(newly_blocked 'a
b' 'a')"
assert_eq "newly_blocked with empty previous returns all" "a" "$(newly_blocked 'a' '')"
assert_eq "fmt_duration" "2h 05m" "$(fmt_duration 7500)"
assert_eq "fmt_duration for no change" "-" "$(fmt_duration -1)"
assert_eq "ips_for_mac merges neighbours (v4 + v6)" "10.0.0.5
fd00::5" "$(ips_for_mac "$TV")"
assert_eq "valid MAC accepted" yes "$(mac_valid 00:11:22:AA:bb:cc && echo yes)"
assert_eq "invalid MAC rejected" no "$(mac_valid 00:11:22 && echo yes || echo no)"

echo "-> JSON configuration contracts"
cd "$REPO_ROOT" || exit 1
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
'
assert_eq "LuCI menu and RPCD ACL contracts valid" 0 "$?"

summary
