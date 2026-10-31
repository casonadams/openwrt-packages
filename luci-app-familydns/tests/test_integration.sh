#!/bin/sh
# Integration test: the real engine against real uci and a real AdGuard Home inside an OpenWrt
# container, with DNS-over-TLS queries sent from the host. Needs docker, python3 and network.
# shellcheck source-path=SCRIPTDIR
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PKG="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

IMAGE="${FAMILYDNS_IMAGE:-openwrt/rootfs:x86-64-25.12.6}"
NAME="familydns-it-$$"
PORT=18853
TMP=$(mktemp -d)
cleanup() {
	docker rm -f "$NAME" >/dev/null 2>&1
	rm -rf "$TMP"
}
trap cleanup EXIT

in_container() {
	docker exec "$NAME" sh /pkg/tests/container-run.sh "$1"
}

docker run -d --name "$NAME" --platform linux/amd64 -p "127.0.0.1:$PORT:853" -v "$PKG:/pkg:ro" "$IMAGE" sleep 900 >/dev/null || exit 1

echo "-> Bootstrap stages against a real AdGuard Home"
out=$(in_container setup 2>&1)
echo "$out" | sed 's/^/    /'
assert_eq "agh stage" yes "$(echo "$out" | grep -q '^OK agh' && echo yes)"
assert_eq "firewall stage" yes "$(echo "$out" | grep -q '^OK firewall' && echo yes)"
assert_eq "clients stage" yes "$(echo "$out" | grep -q '^OK clients' && echo yes)"
rules=$(echo "$out" | sed -n 's/^OK rules: //p')
assert_eq "default blocklist loaded" yes "$([ "${rules:-0}" -gt 1000 ] && echo yes)"
docker cp "$NAME:/tmp/ca.crt" "$TMP/ca.crt" >/dev/null

echo "-> DNS-over-TLS with per-device hostnames"
assert_eq "tracker is blocked for kid1" 0.0.0.0 "$(python3 "$SCRIPT_DIR/dot_query.py" "$PORT" kid1.test.duckdns.org doubleclick.net "$TMP/ca.crt")"
assert_eq "tracker is blocked for dad" 0.0.0.0 "$(python3 "$SCRIPT_DIR/dot_query.py" "$PORT" dad.test.duckdns.org doubleclick.net "$TMP/ca.crt")"
assert_eq "an unknown device name still gets DNS" yes "$([ -n "$(python3 "$SCRIPT_DIR/dot_query.py" "$PORT" stranger.test.duckdns.org example.com "$TMP/ca.crt")" ] && echo yes)"
python3 "$SCRIPT_DIR/dot_query.py" "$PORT" kid1.test.duckdns.org example.com "$TMP/ca.crt" >/dev/null
python3 "$SCRIPT_DIR/dot_query.py" "$PORT" dad.test.duckdns.org example.org "$TMP/ca.crt" >/dev/null
log=$(in_container querylog)
assert_eq "query log attributes queries to kid1" yes "$(echo "$log" | grep -qw kid1 && echo yes)"
assert_eq "query log attributes queries to dad" yes "$(echo "$log" | grep -qw dad && echo yes)"
assert_eq "kid1 resolves through its profile's own upstream" "kid1 upstream: 1.0.0.1:53" "$(echo "$log" | grep '^kid1 upstream')"
assert_eq "dad (no profile upstream) uses the global upstream" "dad upstream: 1.1.1.1:53" "$(echo "$log" | grep '^dad upstream')"

echo "-> Network-wide DNS through AdGuard Home"
lan=$(in_container lan)
assert_eq "lan stage succeeds" yes "$(echo "$lan" | grep -q '^OK lan: network DNS goes through AdGuard Home' && echo yes)"
assert_eq "network profile turns safe search on" "safesearch: true" "$(echo "$lan" | grep '^safesearch')"
assert_eq "network profile turns parental on" "parental: true" "$(echo "$lan" | grep '^parental')"
assert_eq "network profile turns safe browsing on" "safebrowsing: true" "$(echo "$lan" | grep '^safebrowsing')"
assert_eq "local reverse lookups go to dnsmasq" "ptr: 127.0.0.1:53 " "$(echo "$lan" | grep '^ptr')"
assert_eq "the local domain is forwarded to dnsmasq once" "lan rule count: 1" "$(echo "$lan" | grep '^lan rule count:')"
assert_eq "a second run does not duplicate it" "lan rule count after a second run: 1" "$(echo "$lan" | grep 'second run')"
assert_eq "all LAN DNS is redirected to AdGuard Home" "redirect: 'redirect' to port '5300' proto 'tcp udp'" "$(echo "$lan" | grep '^redirect:')"

echo "-> Status and profile"
status=$(in_container status)
field() {
	printf '%s' "$status" | node -e 'const d = JSON.parse(require("fs").readFileSync(0, "utf8")); const v = eval("d." + process.argv[1]); console.log(typeof v === "object" ? JSON.stringify(v) : v)' "$1"
}
assert_eq "status JSON parses" yes "$(printf '%s' "$status" | node -e 'JSON.parse(require("fs").readFileSync(0, "utf8"))' >/dev/null 2>&1 && echo yes)"
assert_eq "cert is present" true "$(field cert.present)"
assert_eq "AdGuard Home is running" true "$(field agh.running)"
assert_eq "DoT is listening" true "$(field agh.dot_listening)"
assert_eq "firewall rule exists" true "$(field firewall_open)"
assert_eq "network DNS is on" true "$(field lan.enabled)"
assert_eq "network DNS is active" true "$(field lan.active)"
assert_eq "both devices are in AdGuard Home" '[true,true]' "$(field 'devices.map(x => x.in_agh)')"
assert_eq "device DoT host" kid1.test.duckdns.org "$(field 'devices[0].dot_host')"
profile=$(in_container profile)
assert_eq "locked profile names the host" yes "$(echo "$profile" | grep -q '<string>kid1.test.duckdns.org</string>' && echo yes)"
assert_eq "locked profile is locked" yes "$(echo "$profile" | grep -q '<true/>' && echo yes)"

echo "-> Turning network DNS off, removing a device, tearing down"
off=$(in_container lan-off)
assert_eq "lan off succeeds" yes "$(echo "$off" | grep -q '^OK lan: off' && echo yes)"
assert_eq "the redirect is removed" "redirect after off: ''" "$(echo "$off" | grep '^redirect after off')"
re=$(in_container resync)
assert_eq "removed device disappears from AdGuard Home" "dad client name after removal: ''" "$(echo "$re" | sed -n 1p)"
assert_eq "other devices are untouched" "kid1 client name still present: 'Kid One'" "$(echo "$re" | sed -n 2p)"
assert_eq "managed list follows" "managed: kid1 " "$(echo "$re" | sed -n 3p)"
td=$(in_container teardown)
assert_eq "teardown removes managed clients" "kid1 after teardown: ''" "$(echo "$td" | grep 'kid1 after teardown')"
assert_eq "teardown removes the firewall rule" "firewall rule: ''" "$(echo "$td" | grep 'firewall rule')"

summary
