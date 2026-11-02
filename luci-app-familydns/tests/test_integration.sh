#!/bin/sh
# Integration test: the real engine against real uci and a real dnsdist inside an OpenWrt
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

dot() {
	python3 "$SCRIPT_DIR/dot_query.py" "$PORT" "$1.test.duckdns.org" "$2" "$TMP/ca.crt"
}

docker run -d --name "$NAME" --platform linux/amd64 -p "127.0.0.1:$PORT:853" -v "$PKG:/pkg:ro" "$IMAGE" sleep 900 >/dev/null || exit 1

echo "-> Bootstrap stages against a real dnsdist"
out=$(in_container setup 2>&1)
echo "$out" | sed 's/^/    /'
assert_eq "dnsdist stage" yes "$(echo "$out" | grep -q '^OK dnsdist' && echo yes)"
assert_eq "firewall stage" yes "$(echo "$out" | grep -q '^OK firewall' && echo yes)"
docker cp "$NAME:/tmp/ca.crt" "$TMP/ca.crt" >/dev/null

echo "-> DNS-over-TLS with per-device hostnames"
assert_eq "kid1 resolves through the kids upstream" 10.0.0.1 "$(dot kid1 who.test)"
assert_eq "dad resolves through the adult upstream" 10.0.0.2 "$(dot dad who.test)"
assert_eq "an unknown device name gets the network profile" 10.0.0.1 "$(dot stranger who.test)"
assert_eq "a dead profile upstream falls back to the fallback server" 10.0.0.3 "$(dot kid2 who.test)"
assert_eq "local names are answered by dnsmasq" 192.168.1.1 "$(dot kid1 router.lan)"

echo "-> Network-wide DNS through dnsdist"
lan=$(in_container lan)
assert_eq "lan stage succeeds" yes "$(echo "$lan" | grep -q '^OK lan: network DNS goes through the resolver' && echo yes)"
assert_eq "all LAN DNS is redirected to dnsdist" "redirect: 'redirect' to port '5300' proto 'tcp udp'" "$(echo "$lan" | grep '^redirect:')"

echo "-> Status and profile"
status=$(in_container status)
field() {
	printf '%s' "$status" | node -e 'const d = JSON.parse(require("fs").readFileSync(0, "utf8")); const v = eval("d." + process.argv[1]); console.log(typeof v === "object" ? JSON.stringify(v) : v)' "$1"
}
assert_eq "status JSON parses" yes "$(printf '%s' "$status" | node -e 'JSON.parse(require("fs").readFileSync(0, "utf8"))' >/dev/null 2>&1 && echo yes)"
assert_eq "cert is present" true "$(field cert.present)"
assert_eq "dnsdist is running" true "$(field dnsdist.running)"
assert_eq "DoT is listening" true "$(field dnsdist.dot_listening)"
assert_eq "firewall rule exists" true "$(field firewall_open)"
assert_eq "network DNS is on" true "$(field lan.enabled)"
assert_eq "network DNS is active" true "$(field lan.active)"
assert_eq "device DoT host" kid1.test.duckdns.org "$(field 'devices[0].dot_host')"
positive() { [ "${1:-0}" -gt 0 ] 2>/dev/null && echo yes || echo no; }
assert_eq "kid1's queries are counted" yes "$(positive "$(field 'devices[0].queries')")"
assert_eq "dad's queries are counted" yes "$(positive "$(field 'devices[1].queries')")"
assert_eq "unmatched queries land in the default count" yes "$(positive "$(field 'queries.default')")"
profile=$(in_container profile)
assert_eq "locked profile names the host" yes "$(echo "$profile" | grep -q '<string>kid1.test.duckdns.org</string>' && echo yes)"
assert_eq "locked profile is locked" yes "$(echo "$profile" | grep -q '<true/>' && echo yes)"

echo "-> Turning network DNS off, removing a device, tearing down"
off=$(in_container lan-off)
assert_eq "lan off succeeds" yes "$(echo "$off" | grep -q '^OK lan: off' && echo yes)"
assert_eq "the redirect is removed" "redirect after off: ''" "$(echo "$off" | grep '^redirect after off')"
re=$(in_container resync)
assert_eq "removed device leaves the config" "dad rule after removal: 0" "$(echo "$re" | grep '^dad rule')"
assert_eq "a removed device falls back to the network profile" 10.0.0.1 "$(dot dad who.test)"
assert_eq "other devices are untouched" 10.0.0.1 "$(dot kid1 who.test)"
td=$(in_container teardown)
assert_eq "teardown removes the firewall rule" "firewall rule: ''" "$(echo "$td" | grep 'firewall rule')"
assert_eq "teardown switches dnsdist off" "dnsdist enabled: '0'" "$(echo "$td" | grep 'dnsdist enabled')"
assert_eq "teardown empties the dnsdist config" "dnsdist config size: 0" "$(echo "$td" | grep 'config size')"

summary
