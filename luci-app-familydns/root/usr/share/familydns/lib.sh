# Pure helpers for familydns, sourced by /usr/bin/familydns and the tests.

uci_q() {
	if [ -n "$UCI_CONFIG_DIR" ]; then
		uci -c "$UCI_CONFIG_DIR" -q "$@"
	else
		uci -q "$@"
	fi
}

new_uuid() {
	cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen
}

json_escape() {
	printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr '\n\t' '  '
}

xml_escape() {
	printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g'
}

slugify() {
	printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -e 's/[^a-z0-9]\{1,\}/-/g' -e 's/^-//' -e 's/-$//' | cut -c1-63
}

valid_client_id() {
	case "$1" in
		'' | *[!abcdefghijklmnopqrstuvwxyz0123456789-]* | -* | *-) return 1 ;;
	esac
	[ "${#1}" -le 63 ]
}

# duck_label example.duckdns.org -> example
duck_label() {
	case "$1" in
		*.duckdns.org) ;;
		*) return 1 ;;
	esac
	label=${1%.duckdns.org}
	case "$label" in
		'' | *[!abcdefghijklmnopqrstuvwxyz0123456789-]* | -* | *-) return 1 ;;
	esac
	echo "$label"
}

# days_until 2027-01-29T18:47:40Z 2026-10-31 -> 90 (whole days, may be negative)
days_until() {
	awk -v a="$1" -v b="$2" '
		function dfc(y, m, d,   era, yoe, doy, doe) {
			y -= (m <= 2); era = int(y / 400)
			yoe = y - era * 400
			doy = int((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1
			doe = yoe * 365 + int(yoe / 4) - int(yoe / 100) + doy
			return era * 146097 + doe
		}
		BEGIN {
			split(substr(a, 1, 10), x, "-"); split(b, y, "-")
			print dfc(x[1] + 0, x[2] + 0, x[3] + 0) - dfc(y[1] + 0, y[2] + 0, y[3] + 0)
		}'
}

# valid_lan_id 192.168.1.50 | 192.168.1.0/24
valid_lan_id() {
	printf '%s\n' "$1" | awk '/^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+(\/[0-9]+)?$/ {
		n = split($0, a, /[.\/]/)
		for (i = 1; i <= 4; i++) if (a[i] > 255) exit 1
		if (n == 5 && a[5] > 32) exit 1
		ok = 1
	} END {exit !ok}'
}

profile_flag() {
	if [ "$(uci_q get "familydns.$1.$2")" = 1 ]; then echo true; else echo false; fi
}

# client_json <device section>: AdGuard Home persistent-client JSON for that device
client_json() {
	sec=$1
	name=$(uci_q get "familydns.$sec.name")
	id=$(uci_q get "familydns.$sec.client_id")
	prof=$(uci_q get "familydns.$sec.profile")
	ss=$(profile_flag "$prof" safe_search)
	services=""
	for svc in $(uci_q get "familydns.$prof.blocked_services"); do
		services="$services${services:+,}\"$(json_escape "$svc")\""
	done
	upstreams=""
	for up in $(uci_q get "familydns.$prof.upstream"); do
		upstreams="$upstreams${upstreams:+,}\"$(json_escape "$up")\""
	done
	use_global=true
	[ -n "$services" ] && use_global=false
	ids="\"$(json_escape "$id")\""
	lan=$(uci_q get "familydns.$sec.lan_ip")
	if [ -n "$lan" ] && valid_lan_id "$lan"; then ids="$ids,\"$(json_escape "$lan")\""; fi
	printf '{"name":"%s","ids":[%s],"tags":[],"upstreams":[%s],' "$(json_escape "$name")" "$ids" "$upstreams"
	printf '"filtering_enabled":%s,"parental_enabled":%s,"safebrowsing_enabled":%s,"safesearch_enabled":%s,' \
		"$(profile_flag "$prof" filtering)" "$(profile_flag "$prof" parental)" "$(profile_flag "$prof" safebrowsing)" "$ss"
	printf '"safe_search":{"enabled":%s,"bing":%s,"duckduckgo":%s,"ecosia":%s,"google":%s,"pixabay":%s,"yandex":%s,"youtube":%s},' \
		"$ss" "$ss" "$ss" "$ss" "$ss" "$ss" "$ss" "$ss"
	printf '"blocked_services":[%s],"use_global_blocked_services":%s,"use_global_settings":false,' "$services" "$use_global"
	printf '"ignore_querylog":false,"ignore_statistics":false}'
}

# mobileconfig: Apple DNS-over-TLS profile from MC_NAME MC_CLIENT_ID MC_DOMAIN MC_IP MC_LOCK MC_FAILOVER MC_UUID1 MC_UUID2
mobileconfig() {
	lock=false
	[ "$MC_LOCK" = 1 ] && lock=true
	failover=""
	[ "$MC_FAILOVER" = 1 ] && failover="<key>AllowFailover</key><true/>"
	addresses=""
	[ -n "$MC_IP" ] && addresses="<key>ServerAddresses</key><array><string>$(xml_escape "$MC_IP")</string></array>"
	name=$(xml_escape "$MC_NAME")
	host=$(xml_escape "$MC_CLIENT_ID.$MC_DOMAIN")
	cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>PayloadContent</key>
	<array>
		<dict>
			<key>DNSSettings</key>
			<dict>
				<key>DNSProtocol</key>
				<string>TLS</string>
				<key>ServerName</key>
				<string>$host</string>
				$addresses
				$failover
			</dict>
			<key>PayloadDescription</key>
			<string>Sends DNS to the home resolver as $name</string>
			<key>PayloadDisplayName</key>
			<string>$name DNS</string>
			<key>PayloadIdentifier</key>
			<string>familydns.$(xml_escape "$MC_CLIENT_ID").settings</string>
			<key>PayloadType</key>
			<string>com.apple.dnsSettings.managed</string>
			<key>PayloadUUID</key>
			<string>$MC_UUID1</string>
			<key>PayloadVersion</key>
			<integer>1</integer>
			<key>ProhibitDisablement</key>
			<$lock/>
		</dict>
	</array>
	<key>PayloadDisplayName</key>
	<string>$name DNS</string>
	<key>PayloadIdentifier</key>
	<string>familydns.$(xml_escape "$MC_CLIENT_ID")</string>
	<key>PayloadRemovalDisallowed</key>
	<$lock/>
	<key>PayloadType</key>
	<string>Configuration</string>
	<key>PayloadUUID</key>
	<string>$MC_UUID2</string>
	<key>PayloadVersion</key>
	<integer>1</integer>
</dict>
</plist>
PLIST
}
