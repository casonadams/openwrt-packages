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
	[ -z "$HTTP_PID" ] || kill "$HTTP_PID" 2>/dev/null
	rm -rf "$TMP"
}
trap cleanup EXIT

in_container() {
	docker exec -e LIST_URL="http://host.docker.internal:$LIST_PORT/list.txt" "$NAME" sh /pkg/tests/container-run.sh "$@"
}

# logged <tag> <name> <rcode>: whether the query log has that answer for that sender
logged() {
	printf '%s' "$LOG" | python3 -c 'import json, sys
d = json.load(sys.stdin)["devices"].get(sys.argv[1], [])
print("yes" if any(e[1] == sys.argv[2] and e[3] == int(sys.argv[3]) for e in d) else "no")' "$1" "$2" "$3"
}

dot() {
	python3 "$SCRIPT_DIR/dot_query.py" "$PORT" "$1.test.duckdns.org" "$2" "$TMP/ca.crt"
}

# The container downloads the ad-blocking list from the host, like the router downloads it from GitHub.
LIST_PORT=18099
mkdir -p "$TMP/www"
printf '%s\n' '# test list' blockedad.test tracker.test > "$TMP/www/list.txt"
python3 -m http.server "$LIST_PORT" --bind 0.0.0.0 --directory "$TMP/www" >/dev/null 2>&1 &
HTTP_PID=$!

docker run -d --name "$NAME" --platform linux/amd64 --add-host=host.docker.internal:host-gateway -p "127.0.0.1:$PORT:853" -v "$PKG:/pkg:ro" "$IMAGE" sleep 900 >/dev/null || exit 1

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
dot kid1 blocked.test >/dev/null
dot kid1 blocked.test >/dev/null
dot stranger blocked.test >/dev/null
echo "-> Ad blocking list"
assert_eq "a listed domain is blocked" "" "$(dot kid1 blockedad.test)"
assert_eq "its subdomains are blocked" "" "$(dot kid1 www.blockedad.test)"
assert_eq "an allowed subdomain of a listed domain still resolves" 10.0.0.9 "$(dot kid1 ok.blockedad.test)"
assert_eq "an unlisted domain still resolves" 10.0.0.1 "$(dot kid1 who.test)"
assert_eq "everyone else is filtered too" "" "$(dot stranger tracker.test)"
assert_eq "a domain the admin blocks is blocked although the upstream resolves it" "" "$(dot kid1 blockme.test)"
assert_eq "its subdomains are blocked" "" "$(dot kid1 a.blockme.test)"
assert_eq "an unrelated domain the upstream resolves is untouched" 10.0.0.7 "$(dot kid1 free.test)"

echo "-> Query log"
LOG=$(in_container log)
assert_eq "a domain blocked by the list is logged as NXDOMAIN" yes "$(logged dev:kid1 blockedad.test 3)"
assert_eq "a domain the profile filter blocks upstream is logged as NXDOMAIN" yes "$(logged dev:kid1 blocked.test 3)"
assert_eq "a resolved domain is logged as NOERROR" yes "$(logged dev:kid1 who.test 0)"
assert_eq "each device has its own log" no "$(logged dev:dad blockedad.test 3)"
assert_eq "unknown senders are logged under the network profile" yes "$(logged default tracker.test 3)"
assert_eq "newest answers come first" free.test "$(printf '%s' "$LOG" | python3 -c 'import json, sys; print(json.load(sys.stdin)["devices"]["dev:kid1"][0][1])')"

echo "-> Network-wide DNS through dnsdist"
lan=$(in_container lan)
assert_eq "lan stage succeeds" yes "$(echo "$lan" | grep -q '^OK lan: network DNS goes through the resolver' && echo yes)"
assert_eq "all LAN DNS, IPv4 and IPv6, is redirected to dnsdist" "redirect: 'redirect' to port '5300' proto 'tcp udp' family 'any'" "$(echo "$lan" | grep '^redirect:')"

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
assert_eq "kid1's blocked answers are counted: two from the filter (one cached) and four from the lists" 6 "$(field 'devices[0].blocked')"
assert_eq "the list is active with its domains" "true 2" "$(field 'blocklist.active') $(field 'blocklist.domains')"
assert_eq "the default sender's NXDOMAIN answers are counted" yes "$(positive "$(field 'queries.default_blocked')")"
assert_eq "a device with no NXDOMAIN answers shows zero" 0 "$(field 'devices[1].blocked')"
profile=$(in_container profile)
assert_eq "profile names the host" yes "$(echo "$profile" | grep -q '<string>kid1.test.duckdns.org</string>' && echo yes)"
assert_eq "profile uses the DoT protocol" yes "$(echo "$profile" | grep -q '<string>TLS</string>' && echo yes)"

echo "-> Updating the list"
printf '%s\n' '# test list' blockedad.test tracker.test newlyadded.test > "$TMP/www/list.txt"
lists=$(in_container lists)
assert_eq "an updated list is applied" "domains: 3" "$(echo "$lists" | grep '^domains')"
assert_eq "a newly listed domain is blocked after the update" "" "$(dot kid1 newlyadded.test)"
assert_eq "other names still resolve after the restart" 10.0.0.1 "$(dot kid1 who.test)"

echo "-> Allow and block from the log"
in_container list-set block free.test >/dev/null
assert_eq "a domain blocked from the log is blocked" "" "$(dot kid1 free.test)"
in_container list-set allow free.test >/dev/null
assert_eq "allowing it again resolves it" 10.0.0.7 "$(dot kid1 free.test)"

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
