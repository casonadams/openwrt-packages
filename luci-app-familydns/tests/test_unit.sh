#!/bin/sh
# shellcheck source-path=SCRIPTDIR
# Unit tests for the familydns helpers and engine functions with a fake uci. Needs sh and node.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PKG="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

TEST_TMP=$(mktemp -d)
trap 'rm -rf "$TEST_TMP"' EXIT

sed '/^case "\$1" in/,$d' "$PKG/root/usr/bin/familydns" > "$TEST_TMP/harness.sh"
export FAMILYDNS_LIB="$PKG/root/usr/share/familydns/lib.sh"
export PROGRESS_FILE="$TEST_TMP/progress" PID_FILE="$TEST_TMP/pid" STATE_DIR="$TEST_TMP/state"
export FIXTURE="$TEST_TMP/fixture"

cat > "$FIXTURE" <<'CFG'
familydns.settings=settings
familydns.settings.enabled=1
familydns.settings.domain=example.duckdns.org
familydns.settings.duckdns_token=secret-token
familydns.settings.email=me@example.com
familydns.settings.dot_port=853
familydns.kids=profile
familydns.kids.name=Kids
familydns.kids.filtering=1
familydns.kids.safe_search=1
familydns.kids.parental=1
familydns.kids.safebrowsing=1
familydns.kids.blocked_services=tiktok roblox
familydns.kids.upstream=https://doh.cleanbrowsing.org/doh/family-filter/ tls://one.one.one.one
familydns.adult=profile
familydns.adult.name=Adult
familydns.adult.filtering=1
familydns.adult.safe_search=0
familydns.@device[0]=device
familydns.@device[0].name=Kid "One" <iPhone>
familydns.@device[0].client_id=kid1
familydns.@device[0].profile=kids
familydns.@device[0].lan_ip=192.168.1.50
familydns.@device[1]=device
familydns.@device[1].name=Dad
familydns.@device[1].client_id=dad
familydns.@device[1].profile=adult
CFG

# shellcheck source=/dev/null
. "$TEST_TMP/harness.sh"

uci_q() {
	case "$1" in
		get) awk -v k="$2" 'index($0, k "=") == 1 {print substr($0, length(k) + 2); exit}' "$FIXTURE" ;;
		show) cat "$FIXTURE" ;;
		*) return 1 ;;
	esac
}

json_ok() {
	printf '%s' "$1" | node -e 'JSON.parse(require("fs").readFileSync(0, "utf8"))' 2>/dev/null && echo yes || echo no
}

json_get() {
	printf '%s' "$1" | node -e 'const d = JSON.parse(require("fs").readFileSync(0, "utf8")); const v = eval("d." + process.argv[1]); console.log(typeof v === "object" ? JSON.stringify(v) : v)' "$2"
}

echo "-> escaping and ids"
assert_eq "json_escape quotes and backslashes" 'a\"b\\c' "$(json_escape 'a"b\c')"
assert_eq "json_escape flattens newlines" 'a b' "$(json_escape 'a
b')"
assert_eq "xml_escape" '&lt;a&gt; &amp; &quot;b&quot;' "$(xml_escape '<a> & "b"')"
assert_eq "slugify a device name" 'kid-1-s-iphone' "$(slugify "Kid 1's iPhone!")"
assert_eq "slugify trims separators" 'dad' "$(slugify '  --Dad--  ')"
assert_eq "slugify caps at 63" 63 "$(slugify "$(printf 'a%.0s' $(seq 1 80))" | tr -d '\n' | wc -c | tr -d ' ')"
for good in kid1 a a-b 0x9 "$(printf 'a%.0s' $(seq 1 63))"; do
	assert_eq "valid id '$(printf '%.12s' "$good")'" yes "$(valid_client_id "$good" && echo yes || echo no)"
done
for bad in '' -kid kid- Kid1 kid_1 'kid 1' kid.one "$(printf 'a%.0s' $(seq 1 64))"; do
	assert_eq "invalid id '$(printf '%.12s' "$bad")'" no "$(valid_client_id "$bad" && echo yes || echo no)"
done
assert_eq "duck_label" example "$(duck_label example.duckdns.org)"
assert_eq "duck_label rejects other domains" no "$(duck_label example.com >/dev/null && echo yes || echo no)"
assert_eq "duck_label rejects sub-subdomains" no "$(duck_label a.b.duckdns.org >/dev/null && echo yes || echo no)"
assert_eq "days_until in the future" 90 "$(days_until 2027-01-29T18:47:40Z 2026-10-31)"
assert_eq "days_until across a leap day" 366 "$(days_until 2028-03-01T00:00:00Z 2027-03-01)"
assert_eq "days_until when expired" -3 "$(days_until 2026-10-28T00:00:00Z 2026-10-31)"

for good in 192.168.1.50 10.0.0.0/8 255.255.255.255/32; do
	assert_eq "valid LAN id $good" yes "$(valid_lan_id "$good" && echo yes || echo no)"
done
for bad in '' 192.168.1 192.168.1.256 192.168.1.1/33 192.168.1.1/ abc 1.2.3.4.5 ' 1.2.3.4'; do
	assert_eq "invalid LAN id '$bad'" no "$(valid_lan_id "$bad" && echo yes || echo no)"
done

echo "-> client JSON"
kid=$(client_json '@device[0]')
dad=$(client_json '@device[1]')
assert_eq "kid JSON is valid even with quotes in the name" yes "$(json_ok "$kid")"
assert_eq "name is preserved" 'Kid "One" <iPhone>' "$(json_get "$kid" name)"
assert_eq "client id and LAN address become the AdGuard ids" '["kid1","192.168.1.50"]' "$(json_get "$kid" ids)"
assert_eq "a device without a LAN address only has its client id" '["dad"]' "$(json_get "$dad" ids)"
assert_eq "kids profile turns on safe search" true "$(json_get "$kid" safe_search.youtube)"
assert_eq "kids profile turns on parental" true "$(json_get "$kid" parental_enabled)"
assert_eq "kids profile blocks services" '["tiktok","roblox"]' "$(json_get "$kid" blocked_services)"
assert_eq "kids profile stops using global blocked services" false "$(json_get "$kid" use_global_blocked_services)"
assert_eq "kids profile carries its own upstreams" '["https://doh.cleanbrowsing.org/doh/family-filter/","tls://one.one.one.one"]' "$(json_get "$kid" upstreams)"
assert_eq "a profile without upstreams leaves the client on the defaults" '[]' "$(json_get "$dad" upstreams)"
assert_eq "adult profile keeps filtering" true "$(json_get "$dad" filtering_enabled)"
assert_eq "adult profile leaves parental off" false "$(json_get "$dad" parental_enabled)"
assert_eq "adult profile uses global blocked services" true "$(json_get "$dad" use_global_blocked_services)"

echo "-> Apple profile"
MC_NAME='Kid "One" <iPhone>' MC_CLIENT_ID=kid1 MC_DOMAIN=example.duckdns.org MC_IP=203.0.113.7 MC_LOCK=0 MC_FAILOVER=1 \
	MC_UUID1=11111111-1111-1111-1111-111111111111 MC_UUID2=22222222-2222-2222-2222-222222222222 mobileconfig > "$TEST_TMP/open.mobileconfig"
MC_NAME=Dad MC_CLIENT_ID=dad MC_DOMAIN=example.duckdns.org MC_IP='' MC_LOCK=1 MC_FAILOVER=0 \
	MC_UUID1=11111111-1111-1111-1111-111111111111 MC_UUID2=22222222-2222-2222-2222-222222222222 mobileconfig > "$TEST_TMP/locked.mobileconfig"
if command -v plutil >/dev/null 2>&1; then
	assert_eq "profile is a valid plist" 0 "$(plutil -lint "$TEST_TMP/open.mobileconfig" >/dev/null 2>&1; echo $?)"
elif command -v xmllint >/dev/null 2>&1; then
	assert_eq "profile is well-formed XML" 0 "$(xmllint --noout "$TEST_TMP/open.mobileconfig" 2>/dev/null; echo $?)"
fi
assert_eq "DoT host is <id>.<domain>" yes "$(grep -q '<string>kid1.example.duckdns.org</string>' "$TEST_TMP/open.mobileconfig" && echo yes)"
assert_eq "bootstrap address is included when known" yes "$(grep -q '<string>203.0.113.7</string>' "$TEST_TMP/open.mobileconfig" && echo yes)"
assert_eq "name is XML-escaped" yes "$(grep -q 'Kid &quot;One&quot; &lt;iPhone&gt; DNS' "$TEST_TMP/open.mobileconfig" && echo yes)"
assert_eq "failover is allowed when asked" yes "$(grep -q '<key>AllowFailover</key><true/>' "$TEST_TMP/open.mobileconfig" && echo yes)"
assert_eq "failover is omitted when off" no "$(grep -q AllowFailover "$TEST_TMP/locked.mobileconfig" && echo yes || echo no)"
assert_eq "open profile is removable" 2 "$(grep -c '<false/>' "$TEST_TMP/open.mobileconfig")"
assert_eq "locked profile prohibits disablement and removal" 2 "$(grep -c '<true/>' "$TEST_TMP/locked.mobileconfig")"
assert_eq "no ServerAddresses when the IP is unknown" no "$(grep -q ServerAddresses "$TEST_TMP/locked.mobileconfig" && echo yes || echo no)"

echo "-> settings and devices"
assert_eq "valid settings pass" ok "$(validate_settings && echo ok)"
assert_eq "label is derived" example "$(validate_settings; echo "$LABEL")"
sed -i.bak 's/^familydns.settings.duckdns_token=.*/familydns.settings.duckdns_token=/' "$FIXTURE"
assert_eq "missing token is reported" "DuckDNS token is empty" "$(validate_settings; echo "$MSG")"
sed -i.bak 's/^familydns.settings.duckdns_token=.*/familydns.settings.duckdns_token=x/; s/^familydns.settings.domain=.*/familydns.settings.domain=example.com/' "$FIXTURE"
assert_eq "non-duckdns domain is rejected" "domain must be a single-label <name>.duckdns.org" "$(validate_settings; echo "$MSG")"
sed -i.bak 's/^familydns.settings.domain=.*/familydns.settings.domain=example.duckdns.org/' "$FIXTURE"
assert_eq "device sections are found" '@device[0] @device[1]' "$(device_sections | tr '\n' ' ' | sed 's/ $//')"
assert_eq "lan ip defaults to 192.168.1.1" 192.168.1.1 "$(lan_ip)"
assert_eq "lan ip can be overridden" 127.0.0.1 "$(AGH_WEB_IP=127.0.0.1 lan_ip)"

echo "-> progress"
assert_eq "no progress file means idle" idle "$(progress_overall)"
progress_init
assert_eq "fresh progress is idle" idle "$(progress_overall)"
progress_set ddns ok "record updated"
progress_set cert running ""
echo $$ > "$PID_FILE"
assert_eq "a running stage with a live process is running" running "$(progress_overall)"
echo 99999999 > "$PID_FILE"
assert_eq "a running stage whose process died is an error" error "$(progress_overall)"
progress_set cert error "no certificate"
assert_eq "error wins" error "$(progress_overall)"
assert_eq "progress JSON is valid" yes "$(json_ok "$(progress_json)")"
assert_eq "progress JSON carries the error message" "no certificate" "$(json_get "$(progress_json)" message)"
for s in $STAGES; do progress_set "$s" ok ""; done
assert_eq "all ok is ok" ok "$(progress_overall)"
assert_eq "all six stages are listed" 6 "$(json_get "$(progress_json)" stages.length)"
assert_eq "network DNS is the last stage" lan "$(json_get "$(progress_json)" 'stages[5].name')"

summary
