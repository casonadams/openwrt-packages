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
export PROGRESS_FILE="$TEST_TMP/progress" PID_FILE="$TEST_TMP/pid" STATE_DIR="$TEST_TMP/state" ACME_SSL="$TEST_TMP/acme"
export FIXTURE="$TEST_TMP/fixture"

cat > "$FIXTURE" <<'CFG'
familydns.settings=settings
familydns.settings.enabled=1
familydns.settings.domain=example.duckdns.org
familydns.settings.duckdns_token=secret-token
familydns.settings.email=me@example.com
familydns.settings.dot_port=853
familydns.everyone=device
familydns.everyone.name=Everyone else
familydns.everyone.profile=kids
familydns.settings.fallback=9.9.9.9
familydns.kids=profile
familydns.kids.name=Kids
familydns.kids.upstream=https://doh.cleanbrowsing.org/doh/family-filter/ tls://one.one.one.one
familydns.adult=profile
familydns.adult.name=Adult
familydns.adult.upstream=1.1.1.1:5353
familydns.bare=profile
familydns.bare.name=Bare
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

# shellcheck disable=SC2329
uci_q() {
	case "$1" in
		get) awk -v k="$2" 'index($0, k "=") == 1 {print substr($0, length(k) + 2); exit}' "$FIXTURE" ;;
		show) cat "$FIXTURE" ;;
		*) return 1 ;;
	esac
}

with_fixture() {
	saved=$FIXTURE
	FIXTURE=$1
	shift
	"$@"
	FIXTURE=$saved
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

echo "-> upstream parsing"
parse_upstream https://doh.cleanbrowsing.org/doh/family-filter/
assert_eq "DoH keeps host and path" "doh doh.cleanbrowsing.org 443 /doh/family-filter/" "$UP_KIND $UP_HOST $UP_PORT $UP_PATH"
parse_upstream https://dns.example:8443
assert_eq "DoH without a path uses /dns-query and its own port" "doh dns.example 8443 /dns-query" "$UP_KIND $UP_HOST $UP_PORT $UP_PATH"
parse_upstream tls://one.one.one.one
assert_eq "DoT defaults to 853" "dot one.one.one.one 853" "$UP_KIND $UP_HOST $UP_PORT"
parse_upstream 9.9.9.9
assert_eq "a plain IP defaults to 53" "plain 9.9.9.9 53" "$UP_KIND $UP_HOST $UP_PORT"
parse_upstream 127.0.0.1:5353
assert_eq "a plain IP keeps its port" "plain 127.0.0.1 5353" "$UP_KIND $UP_HOST $UP_PORT"
for bad in '' dns.example 'tls://' tls://a:b tls://a/path https://a:0 https://a:70000 'https://a b' 300.1.1.1 1.1.1.1/24 quic://x; do
	assert_eq "rejects upstream '$bad'" no "$(parse_upstream "$bad" && echo yes || echo no)"
done
parse_upstream https://doh.example/dns-query
assert_eq "DoH server line" 'newServer({address="203.0.113.5:443", pool="kids", order=1, checkInterval=30, tls="openssl", subjectName="doh.example", validateCertificates=true, caStore="/etc/ssl/certs/ca-certificates.crt", dohPath="/dns-query"})' "$(server_lua kids 1 203.0.113.5)"
parse_upstream tls://dot.example:8853
quoted_pool='p"q'
assert_eq "DoT server line has no dohPath" 'newServer({address="203.0.113.6:8853", pool="p\"q", order=2, checkInterval=30, tls="openssl", subjectName="dot.example", validateCertificates=true, caStore="/etc/ssl/certs/ca-certificates.crt"})' "$(server_lua "$quoted_pool" 2 203.0.113.6)"
parse_upstream 1.1.1.1
assert_eq "plain server line is a bare address" 'newServer({address="1.1.1.1:53", pool="kids", order=101, checkInterval=30})' "$(server_lua kids 101 1.1.1.1)"
assert_eq "enddate_iso converts openssl dates" 2027-01-29T18:47:40Z "$(enddate_iso 'Jan 29 18:47:40 2027 GMT')"
assert_eq "enddate_iso handles a space-padded day" 2026-12-09T01:02:03Z "$(enddate_iso 'Dec  9 01:02:03 2026 GMT')"

echo "-> dnsdist config"
mkdir -p "$ACME_SSL"
echo cert > "$ACME_SSL/*.example.duckdns.org.fullchain.crt"
echo key > "$ACME_SSL/*.example.duckdns.org.key"
# shellcheck disable=SC2329
resolveip() {
	case "$4" in
		doh.cleanbrowsing.org) echo 185.228.168.10 ;;
		one.one.one.one) echo 1.1.1.1 ;;
	esac
}
conf=$(render_dnsdist; echo "rc=$?")
assert_eq "render succeeds" rc=0 "$(echo "$conf" | tail -n 1)"
has() { printf '%s\n' "$conf" | grep -F -- "$1" >/dev/null && echo yes || echo no; }
count() { printf '%s\n' "$conf" | grep -cF -- "$1"; }
crt="$ACME_SSL/*.example.duckdns.org.fullchain.crt"
tls_line="addTLSLocal(\"0.0.0.0:853\", \"$crt\""
assert_eq "DoT listens with the wildcard cert" yes "$(has "$tls_line")"
assert_eq "plain DNS listens on loopback and the LAN address" 2 "$(count ":5300")"
assert_eq "kids DoH upstream is resolved and ordered first" yes "$(has 'address="185.228.168.10:443", pool="kids", order=1,')"
assert_eq "kids DoT upstream is second" yes "$(has 'address="1.1.1.1:853", pool="kids", order=2,')"
assert_eq "adult plain upstream keeps its port" yes "$(has 'address="1.1.1.1:5353", pool="adult", order=1,')"
assert_eq "fallback servers come after every profile upstream" yes "$(has 'address="9.9.9.9:53", pool="kids", order=101')"
assert_eq "an unused profile gets no pool" 0 "$(count 'pool="bare"')"
assert_eq "per-address rate limit defaults to 500" yes "$(has 'MaxQPSIPRule(500, 32, 128)')"
assert_eq "DoT names are matched by SNI and tagged" yes "$(has 'addAction(AndRule({SNIRule("kid1.example.duckdns.org"), NotRule(TagRule("who"))}), SetTagAction("who", "dev:kid1"), {name="dev:kid1"})')"
assert_eq "a tagged query goes to its profile" yes "$(has 'addAction(TagRule("who", "dev:kid1"), PoolAction("kids"))')"
assert_eq "an untagged query is the default sender" yes "$(has 'addAction(NotRule(TagRule("who")), SetTagAction("who", "default"), {name="default"})')"
assert_eq "NXDOMAIN answers are counted per device, live and from the cache" 2 "$(count 'name="nx:dev:kid1"')"
assert_eq "NXDOMAIN answers are counted for the default sender too" 2 "$(count 'name="nx:default"')"
assert_eq "a device's LAN address tags it too, unless already tagged" yes "$(has 'addAction(AndRule({NetmaskGroupRule("192.168.1.50"), NotRule(TagRule("who"))}), SetTagAction("who", "dev:kid1"), {name="dev:kid1"})')"
assert_eq "outside the LAN an unknown name is refused" yes "$(has 'SNIRule("kid1.example.duckdns.org"), SNIRule("dad.example.duckdns.org")}))}), RCodeAction(DNSRCode.REFUSED), {name="refused"})')"
assert_eq "local names go to dnsmasq" yes "$(has 'addAction(SuffixMatchNodeRule(localnames), PoolAction("local"), {name="local"})')"
assert_eq "everything else uses the network profile" yes "$(has 'addAction(TagRule("who", "default"), PoolAction("kids"))')"
line_of() { printf '%s\n' "$conf" | grep -nF -- "$1" | head -n 1 | cut -d: -f1; }
assert_eq "the default pool rule comes after the device pool rules" yes "$([ "$(line_of 'TagRule("who", "dev:kid1"), PoolAction')" -lt "$(line_of 'TagRule("who", "default"), PoolAction')" ] && echo yes || echo no)"
assert_eq "the refuse rule comes before any tagging" yes "$([ "$(line_of REFUSED)" -lt "$(line_of 'SetTagAction("who", "dev:kid1")')" ] && echo yes || echo no)"

{ cat "$FIXTURE"; echo familydns.settings.ratelimit=0; } > "$FIXTURE.rl"
assert_eq "rate limit 0 leaves it off" 0 "$(with_fixture "$FIXTURE.rl" render_dnsdist | grep -c MaxQPSIPRule)"
rm "$ACME_SSL"/*.key
assert_eq "no key means no DoT listener" 0 "$(render_dnsdist | grep -c addTLSLocal)"
echo key > "$ACME_SSL/*.example.duckdns.org.key"
sed '/^familydns.@device/d' "$FIXTURE" > "$FIXTURE.nodev"
assert_eq "without devices every outside source is refused" yes "$(with_fixture "$FIXTURE.nodev" render_dnsdist | grep -F 'addAction(NotRule(NetmaskGroupRule(private)), RCodeAction(DNSRCode.REFUSED), {name="refused"})' >/dev/null && echo yes)"
sed 's/^familydns.@device\[1\].profile=adult/familydns.@device[1].profile=ghost/' "$FIXTURE" > "$FIXTURE.ghost"
with_fixture "$FIXTURE.ghost" render_dnsdist >/dev/null; assert_eq "a device with a missing profile is reported" "device 'dad' uses the missing profile 'ghost'" "$MSG"
sed 's/^familydns.everyone.profile=.*/familydns.everyone.profile=ghost/' "$FIXTURE" > "$FIXTURE.langhost"
with_fixture "$FIXTURE.langhost" render_dnsdist >/dev/null; assert_eq "a missing network profile is reported" "network profile 'ghost' does not exist" "$MSG"
sed 's/^familydns.@device\[0\].client_id=.*/familydns.@device[0].client_id=Bad_ID/' "$FIXTURE" > "$FIXTURE.badid"
with_fixture "$FIXTURE.badid" render_dnsdist >/dev/null; assert_eq "an invalid client id is reported" "device 'Bad_ID' has an invalid client id" "$MSG"
sed 's/^familydns.@device\[0\].lan_ip=.*/familydns.@device[0].lan_ip=10.0.0/' "$FIXTURE" > "$FIXTURE.badlan"
with_fixture "$FIXTURE.badlan" render_dnsdist >/dev/null; assert_eq "an invalid LAN address is reported" "device 'kid1' has an invalid LAN address '10.0.0'" "$MSG"
sed 's/^familydns.kids.upstream=.*/familydns.kids.upstream=/' "$FIXTURE" > "$FIXTURE.noup"
with_fixture "$FIXTURE.noup" render_dnsdist >/dev/null; assert_eq "a profile without upstreams is reported, not hidden by the fallback" "profile 'kids' has no upstream servers" "$MSG"
sed 's/^familydns.kids.upstream=.*/familydns.kids.upstream=quic:\/\/x/' "$FIXTURE" > "$FIXTURE.badup"
with_fixture "$FIXTURE.badup" render_dnsdist >/dev/null; assert_eq "an invalid upstream is reported" "invalid upstream 'quic://x' for profile 'kids'" "$MSG"
# shellcheck disable=SC2329
resolveip() { :; }
rm -rf "$STATE_DIR/resolved"
sed 's/^familydns.settings.fallback=.*//' "$FIXTURE" | sed 's/^familydns.kids.upstream=.*/familydns.kids.upstream=tls:\/\/one.one.one.one/' > "$FIXTURE.dead"
with_fixture "$FIXTURE.dead" render_dnsdist >/dev/null; assert_eq "a profile whose upstreams cannot be resolved is reported" "profile 'kids' has no reachable upstream (check the router's DNS)" "$MSG"
# shellcheck disable=SC2329
resolveip() { echo 1.1.1.1; }
render_dnsdist >/dev/null
# shellcheck disable=SC2329
resolveip() { :; }
assert_eq "the last good answer survives a DNS outage" 1.1.1.1 "$(resolve_upstream_ip one.one.one.one)"
assert_eq "an IP literal is used as is" 192.0.2.9 "$(resolve_upstream_ip 192.0.2.9)"
unset -f resolveip

echo "-> default section"
assert_eq "the default section names the network profile" kids "$(lan_profile)"
assert_eq "network DNS is off until the default section enables it" no "$(default_enabled && echo yes || echo no)"
{ cat "$FIXTURE"; echo familydns.everyone.enabled=1; } > "$FIXTURE.on"
enabled_echo() { default_enabled && echo yes || echo no; }
assert_eq "enabled=1 turns network DNS on" yes "$(with_fixture "$FIXTURE.on" enabled_echo)"
sed '/^familydns.everyone/d' "$FIXTURE" > "$FIXTURE.legacy"
{ cat "$FIXTURE.legacy"; echo familydns.settings.lan_profile=adult; echo familydns.settings.lan_dns=1; } > "$FIXTURE.legacy2"
UCI_LOG="$TEST_TMP/uci.log"; : > "$UCI_LOG"
# shellcheck disable=SC2329
uci_q() {
	case "$1" in
		get) awk -v k="$2" 'index($0, k "=") == 1 {print substr($0, length(k) + 2); exit}' "$FIXTURE.legacy2" ;;
		*) echo "$*" >> "$UCI_LOG" ;;
	esac
}
migrate_default
assert_eq "migration creates the section with the old profile" yes "$(grep -qx 'set familydns.everyone.profile=adult' "$UCI_LOG" && echo yes)"
assert_eq "migration keeps network DNS on" yes "$(grep -qx 'set familydns.everyone.enabled=1' "$UCI_LOG" && echo yes)"
assert_eq "migration removes the old settings" 2 "$(grep -c '^delete familydns.settings.lan_' "$UCI_LOG")"
assert_eq "migration puts the section first" yes "$(grep -qx 'reorder familydns.everyone=0' "$UCI_LOG" && echo yes)"
: > "$UCI_LOG"
# shellcheck disable=SC2329
uci_q() {
	case "$1" in
		get) awk -v k="$2" 'index($0, k "=") == 1 {print substr($0, length(k) + 2); exit}' "$FIXTURE" ;;
		show) cat "$FIXTURE" ;;
		*) return 1 ;;
	esac
}
migrate_default
assert_eq "migration does nothing when the section exists" 0 "$(wc -l < "$UCI_LOG" | tr -d ' ')"
assert_eq "the default section is not a listed device" '@device[0] @device[1]' "$(device_sections | tr '\n' ' ' | sed 's/ $//')"

echo "-> query counters"
assert_eq "the API is loopback only and keyed" yes "$(has "webserver(\"127.0.0.1:8083\")")"
key=$(api_key)
assert_eq "the API key is generated once and kept" "$key" "$(api_key)"
assert_eq "the API key is in the config" yes "$(render_dnsdist | grep -F "apiKey=\"$key\"" >/dev/null && echo yes)"
assert_eq "the API key file is not world readable" 600 "$(stat -c %a "$STATE_DIR/api.key" 2>/dev/null || stat -f %Lp "$STATE_DIR/api.key")"
assert_eq "every rule is named so counts line up" 0 "$(printf '%s\n' "$conf" | grep '^add[A-Za-z]*Action' | grep -v 'PoolAction' | grep -vc 'name=')"
# shellcheck disable=SC2329
wget() {
	printf '%s' '{"rules": [{"action": "drop", "action-stats": {"": 0}, "creationOrder": 0, "id": 0, "matches": 0, "name": "limited", "rule": "x", "uuid": "a"}, {"action": "to pool kids", "action-stats": {"": 0}, "creationOrder": 1, "id": 1, "matches": 7, "name": "dev:kid1", "rule": "SNI", "uuid": "b"}, {"action": "to pool kids", "action-stats": {"": 0}, "creationOrder": 2, "id": 2, "matches": 5, "name": "dev:kid1", "rule": "Src", "uuid": "c"}, {"action": "to pool kids", "action-stats": {"": 0}, "creationOrder": 3, "id": 3, "matches": 1200, "name": "default", "rule": "All", "uuid": "d"}, {"action": "allow", "action-stats": {"": 0}, "creationOrder": 4, "id": 0, "matches": 3, "name": "nx:dev:kid1", "rule": "x", "uuid": "e"}, {"action": "allow", "action-stats": {"": 0}, "creationOrder": 5, "id": 1, "matches": 2, "name": "nx:dev:kid1", "rule": "x", "uuid": "f"}, {"action": "allow", "action-stats": {"": 0}, "creationOrder": 6, "id": 2, "matches": 9, "name": "nx:default", "rule": "x", "uuid": "g"}]}'
}
counts=$(rule_counts)
assert_eq "rule counts are read from the API body" "limited 0 dev:kid1 7 dev:kid1 5 default 1200 nx:dev:kid1 3 nx:dev:kid1 2 nx:default 9" "$(echo "$counts" | tr '\n' ' ' | sed 's/ $//')"
assert_eq "a device's SNI and LAN rules are added up" 12 "$(sum_counts dev:kid1 "$counts")"
assert_eq "a rule that never matched is zero, not missing" 0 "$(sum_counts limited "$counts")"
assert_eq "the default path is counted" 1200 "$(sum_counts default "$counts")"
assert_eq "an unknown rule has no count" "" "$(sum_counts dev:ghost "$counts")"
assert_eq "no counts at all means unknown" "" "$(sum_counts default "")"
assert_eq "unknown counts become JSON null" null "$(number_or_null "")"
assert_eq "zero stays a number" 0 "$(number_or_null 0)"
devs=$(devices_json "$counts")
assert_eq "devices JSON is valid" yes "$(json_ok "$devs")"
assert_eq "a device carries its summed queries" 12 "$(json_get "$devs" 'at(0).queries')"
assert_eq "a device without counters is null" null "$(json_get "$devs" 'at(1).queries')"
assert_eq "a device carries its blocked answers, live and cached" 5 "$(json_get "$devs" 'at(0).blocked')"
assert_eq "the default sender's blocked answers are counted" 9 "$(sum_counts nx:default "$counts")"
assert_eq "devices JSON without any counts is valid" yes "$(json_ok "$(devices_json "")")"
# shellcheck disable=SC2329
wget() { return 1; }
assert_eq "an unreachable API means no counts" "" "$(rule_counts)"
unset -f wget

echo "-> Apple profile"
MC_NAME='Kid "One" <iPhone>' MC_CLIENT_ID=kid1 MC_DOMAIN=example.duckdns.org MC_IP=203.0.113.7 MC_FAILOVER=1 \
	MC_UUID1=11111111-1111-1111-1111-111111111111 MC_UUID2=22222222-2222-2222-2222-222222222222 mobileconfig > "$TEST_TMP/open.mobileconfig"
MC_NAME=Dad MC_CLIENT_ID=dad MC_DOMAIN=example.duckdns.org MC_IP='' MC_FAILOVER=0 \
	MC_UUID1=11111111-1111-1111-1111-111111111111 MC_UUID2=22222222-2222-2222-2222-222222222222 mobileconfig > "$TEST_TMP/nofailover.mobileconfig"
if command -v plutil >/dev/null 2>&1; then
	assert_eq "profile is a valid plist" 0 "$(plutil -lint "$TEST_TMP/open.mobileconfig" >/dev/null 2>&1; echo $?)"
elif command -v xmllint >/dev/null 2>&1; then
	assert_eq "profile is well-formed XML" 0 "$(xmllint --noout "$TEST_TMP/open.mobileconfig" 2>/dev/null; echo $?)"
fi
assert_eq "DoT host is <id>.<domain>" yes "$(grep -q '<string>kid1.example.duckdns.org</string>' "$TEST_TMP/open.mobileconfig" && echo yes)"
assert_eq "bootstrap address is included when known" yes "$(grep -q '<string>203.0.113.7</string>' "$TEST_TMP/open.mobileconfig" && echo yes)"
assert_eq "name is XML-escaped" yes "$(grep -q 'Kid &quot;One&quot; &lt;iPhone&gt; DNS' "$TEST_TMP/open.mobileconfig" && echo yes)"
assert_eq "failover is allowed when asked" yes "$(grep -q '<key>AllowFailover</key><true/>' "$TEST_TMP/open.mobileconfig" && echo yes)"
assert_eq "failover is omitted when off" no "$(grep -q AllowFailover "$TEST_TMP/nofailover.mobileconfig" && echo yes || echo no)"
assert_eq "the profile can always be removed" 0 "$(grep -c -E 'ProhibitDisablement|PayloadRemovalDisallowed' "$TEST_TMP/open.mobileconfig")"
assert_eq "no ServerAddresses when the IP is unknown" no "$(grep -q ServerAddresses "$TEST_TMP/nofailover.mobileconfig" && echo yes || echo no)"

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
assert_eq "lan ip can be overridden" 127.0.0.1 "$(LAN_IP=127.0.0.1 lan_ip)"

echo "-> DuckDNS update result messages"
# shellcheck disable=SC2329
sleep() { :; }
# shellcheck disable=SC2329
wget() { printf "%s" "$FAKE_REPLY"; }
FAKE_REPLY=OK; MSG=""
assert_eq "an OK reply succeeds" ok "$(duckdns_update example && echo ok)"
FAKE_REPLY=KO; duckdns_update example; assert_eq "a KO reply blames the token or name" "DuckDNS rejected the update (wrong token or name?)" "$MSG"
FAKE_REPLY=""; duckdns_update example; assert_eq "an empty reply blames connectivity, not the token" "could not reach DuckDNS (check the router's DNS and internet access)" "$MSG"
unset -f wget sleep

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
assert_eq "all five stages are listed" 5 "$(json_get "$(progress_json)" stages.length)"
assert_eq "network DNS is the last stage" lan "$(json_get "$(progress_json)" 'stages[4].name')"

summary
