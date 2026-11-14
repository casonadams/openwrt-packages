#!/bin/sh
# shellcheck source-path=SCRIPTDIR
# Test suite for the screentime engine (engine functions + decide.awk), run with a faked
# clock, UCI dump, nft, conntrack and ip. Requires sh, awk and node.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PKG="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"
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
screentime.schedule_a.name='Evening'
screentime.schedule_a.enabled='1'
screentime.schedule_a.weekdays='mon' 'tue' 'wed' 'thu' 'sun'
screentime.schedule_a.start_time='18:00:00'
screentime.schedule_a.duration='150'
screentime.schedule_a.devices='all'
screentime.@schedule[1]=schedule
screentime.@schedule[1].weekdays='fri sat'
screentime.@schedule[1].start_time='6:00 PM'
screentime.@schedule[1].duration='240'
screentime.late=schedule
screentime.late.weekdays='sun'
screentime.late.start_time='23:00:00'
screentime.late.duration='120'
screentime.late.devices='00:00:5e:00:53:02'
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
at mon 17 0
assert_eq "Schedule next change matches" "0|3600|3600" "$(load_state; decide lines | awk -F'|' '$2 == "schedule_a" {print $3 "|" $5 "|" $6}')"

echo "-> Master switch and no schedules"
cp "$TEST_TMP/fixture" "$TEST_TMP/fixture.orig"
sed "s/settings.enabled='1'/settings.enabled='0'/" "$TEST_TMP/fixture.orig" > "$TEST_TMP/fixture"
at sat 10 0; assert_eq "master switch off allows everything" allowed "$(state $TV)"
grep -v 'schedule' "$TEST_TMP/fixture.orig" | sed "s/'0'/'1'/" > "$TEST_TMP/fixture"
at mon 18 30; assert_eq "no schedules blocks 24/7" blocked "$(state $TV)"
assert_eq "no schedules: no next change" -1 "$(load_state; decide lines | awk -F'|' -v m=$TV '$2 == m {print $5}')"
cp "$TEST_TMP/fixture.orig" "$TEST_TMP/fixture"

echo "-> JSON output"
at mon 18 30
decide_json() { load_state; decide json; }
decide_json > "$TEST_TMP/status.json"
node -e '
const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const tv = s.devices.find(d => d.mac === "00:00:5e:00:53:01");
const a = s.schedules.find(x => x.id === "schedule_a");
const ok = s.enabled === 1 && tv.allowed === true && tv.name === "Living Room TV"
	&& tv.change_at === s.now + 7200 && s.devices.length === 2 && s.schedules.length === 3
	&& a.name === "Evening" && a.open === true && a.override === "none" && a.change_at === s.now + 7200;
process.exit(ok ? 0 : 1);
' "$TEST_TMP/status.json"
assert_eq "status --json is valid and consistent" 0 "$?"

echo "-> Per-schedule overrides"
field() { load_state; decide lines | awk -F'|' -v k="$1" -v n="$2" '$2 == k {print $n}'; }
fails() { { ( "$@" ) >/dev/null; } 2>&1; }
echo "ignore 1900000000" > "$OVERRIDE_FILE"
at sun 12 0
assert_eq "pre-upgrade global override line is ignored" blocked "$(state $TV)"
set_override ignore late >/dev/null
assert_eq "ignore lasts until this schedule opens (Sun 23:00), not the next window of any schedule" \
	"late ignore $((1800000000 + 23 * 3600))" "$(cat "$OVERRIDE_FILE")"
assert_eq "ignore allows the schedule's device" allowed "$(state $TABLET)"
assert_eq "ignore leaves devices of other schedules blocked" blocked "$(state $TV)"
assert_eq "ignored schedule reports its override" "1|ignore" "$(field late 3)|$(field late 4)"
assert_eq "overridden device is reported as override" override "$(field $TABLET 4)"
assert_eq "device stays allowed through both windows until 01:00" $((13 * 3600)) "$(field $TABLET 5)"
at sun 22 59; assert_eq "ignore still active a minute before the window" allowed "$(state $TABLET)"
at sun 23 0;  assert_eq "ignore expires exactly at window open" none "$(field late 4)"
at sun 19 0
set_override forced evening >/dev/null
assert_eq "schedule found by name; both overrides kept" "late schedule_a" "$(cut -d' ' -f1 "$OVERRIDE_FILE" | tr '\n' ' ' | sed 's/ $//')"
assert_eq "forced lasts until the window closes (Sun 20:30)" "$((1800000000 + 20 * 3600 + 30 * 60))" "$(awk '$1 == "schedule_a" {print $3}' "$OVERRIDE_FILE")"
assert_eq "forced blocks devices only that schedule covers" blocked "$(state $TV)"
assert_eq "a device another open schedule covers stays allowed" allowed "$(state $TABLET)"
clear_override late >/dev/null
assert_eq "resume drops only that schedule's override" schedule_a "$(cut -d' ' -f1 "$OVERRIDE_FILE")"
assert_eq "resumed schedule follows its windows again" blocked "$(state $TABLET)"
at sun 20 30; assert_eq "forced ends when the window closes" none "$(field schedule_a 4)"
clear_override >/dev/null
assert_eq "resume without a schedule removes every override" no "$([ -f "$OVERRIDE_FILE" ] && echo yes || echo no)"
at sun 23 30
assert_eq "ignoring an open schedule is refused" "Error: schedule 'late' is already open" "$(fails set_override ignore late)"
assert_eq "forcing a closed schedule is refused" "Error: schedule 'Evening' is already in downtime" "$(fails set_override forced Evening)"
assert_eq "anonymous schedule is refused" "Error: schedule '@schedule[1]' has no section name; name it with 'uci rename' first" \
	"$(fails set_override ignore '@schedule[1]')"
assert_eq "disabled schedule is refused" "Error: no enabled schedule '@schedule[3]'" "$(fails clear_override '@schedule[3]')"
assert_eq "refused commands write nothing" no "$([ -f "$OVERRIDE_FILE" ] && echo yes || echo no)"
printf 'late bogus 1900000000\nlate ignore soon\nnope ignore 1900000000\n' > "$OVERRIDE_FILE"
at sun 12 0; assert_eq "malformed and unknown-schedule lines are ignored" blocked "$(state $TABLET)"
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
export SCREENTIME_CLOCK="mon 100 1000"
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
cd "$PKG" || exit 1
node -e '
const fs = require("fs");
const menu = JSON.parse(fs.readFileSync("root/usr/share/luci/menu.d/luci-app-screentime.json", "utf8"));
if (!menu["admin/services/screentime"]) throw new Error("Missing menu entry");
if (menu["admin/services/screentime"].action.type !== "view") throw new Error("Invalid menu action type");

const acl = JSON.parse(fs.readFileSync("root/usr/share/rpcd/acl.d/luci-app-screentime.json", "utf8"));
if (!acl["luci-app-screentime"]) throw new Error("Missing ACL root");
const readAcl = acl["luci-app-screentime"].read;
const writeAcl = acl["luci-app-screentime"].write;
if (!readAcl.uci.includes("screentime")) throw new Error("Missing UCI read ACL");
if (!writeAcl.uci.includes("screentime")) throw new Error("Missing UCI write ACL");
if (!writeAcl.file["/usr/bin/screentime"]) throw new Error("Missing file exec ACL");
'
assert_eq "LuCI menu and RPCD ACL contracts valid" 0 "$?"

summary
