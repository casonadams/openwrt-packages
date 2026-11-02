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
familydns.settings.lan_profile=kids
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
assert_eq "DoT names are matched by SNI" yes "$(has 'addAction(SNIRule("kid1.example.duckdns.org"), PoolAction("kids"))')"
assert_eq "a device's LAN address routes to its profile" yes "$(has 'addAction(NetmaskGroupRule("192.168.1.50"), PoolAction("kids"))')"
assert_eq "outside the LAN an unknown name is refused" yes "$(has 'SNIRule("kid1.example.duckdns.org"), SNIRule("dad.example.duckdns.org")}))}), RCodeAction(DNSRCode.REFUSED))')"
assert_eq "local names go to dnsmasq" yes "$(has 'addAction(SuffixMatchNodeRule(localnames), PoolAction("local"))')"
assert_eq "everything else uses the network profile" yes "$(has 'addAction(AllRule(), PoolAction("kids"))')"
line_of() { printf '%s\n' "$conf" | grep -nF -- "$1" | head -n 1 | cut -d: -f1; }
last=$(printf '%s\n' "$conf" | grep -v '^rc=' | tail -n 1)
assert_eq "the default route is last" 'addAction(AllRule(), PoolAction("kids"))' "$last"
assert_eq "the refuse rule comes before any device route" yes "$([ "$(line_of REFUSED)" -lt "$(line_of 'SNIRule("kid1.example.duckdns.org"), PoolAction')" ] && echo yes || echo no)"

{ cat "$FIXTURE"; echo familydns.settings.ratelimit=0; } > "$FIXTURE.rl"
assert_eq "rate limit 0 leaves it off" 0 "$(with_fixture "$FIXTURE.rl" render_dnsdist | grep -c MaxQPSIPRule)"
rm "$ACME_SSL"/*.key
assert_eq "no key means no DoT listener" 0 "$(render_dnsdist | grep -c addTLSLocal)"
echo key > "$ACME_SSL/*.example.duckdns.org.key"
sed '/^familydns.@device/d' "$FIXTURE" > "$FIXTURE.nodev"
assert_eq "without devices every outside source is refused" yes "$(with_fixture "$FIXTURE.nodev" render_dnsdist | grep -F 'addAction(NotRule(NetmaskGroupRule(private)), RCodeAction(DNSRCode.REFUSED))' >/dev/null && echo yes)"
sed 's/^familydns.@device\[1\].profile=adult/familydns.@device[1].profile=ghost/' "$FIXTURE" > "$FIXTURE.ghost"
with_fixture "$FIXTURE.ghost" render_dnsdist >/dev/null; assert_eq "a device with a missing profile is reported" "device 'dad' uses the missing profile 'ghost'" "$MSG"
sed 's/^familydns.settings.lan_profile=.*/familydns.settings.lan_profile=ghost/' "$FIXTURE" > "$FIXTURE.langhost"
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
