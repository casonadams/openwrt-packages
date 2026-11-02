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

# enddate_iso "Jan 29 18:47:40 2027 GMT" -> 2027-01-29T18:47:40Z (the openssl -enddate format)
enddate_iso() {
	printf '%s\n' "$1" | awk 'BEGIN {split("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec", m, " ")}
		NF >= 4 {
			for (i = 1; i <= 12; i++) if (m[i] == $1) mo = i
			if (mo) printf "%s-%02d-%02dT%sZ\n", $4, mo, $2, $3
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

valid_ipv4() {
	case "$1" in */*) return 1 ;; esac
	valid_lan_id "$1"
}

# lua_str <text>: a double-quoted Lua string literal
lua_str() {
	printf '"%s"' "$(json_escape "$1")"
}

# parse_upstream <upstream>: sets UP_KIND (doh|dot|plain), UP_HOST, UP_PORT and UP_PATH.
# Accepts https://host[:port][/path] (DoH), tls://host[:port] (DoT) and a plain IPv4[:port].
parse_upstream() {
	UP_PATH=""
	case "$1" in
		https://*) UP_KIND=doh UP_PORT=443 rest=${1#https://} ;;
		tls://*) UP_KIND=dot UP_PORT=853 rest=${1#tls://} ;;
		*) UP_KIND=plain UP_PORT=53 rest=$1 ;;
	esac
	hostport=${rest%%/*}
	if [ "$UP_KIND" = doh ]; then
		UP_PATH=${rest#"$hostport"}
		[ -n "$UP_PATH" ] || UP_PATH=/dns-query
	elif [ "$hostport" != "$rest" ]; then
		return 1
	fi
	UP_HOST=${hostport%%:*}
	case "$hostport" in *:*) UP_PORT=${hostport#*:} ;; esac
	case "$UP_HOST" in '' | *[!A-Za-z0-9.-]*) return 1 ;; esac
	case "$UP_PORT" in '' | *[!0-9]*) return 1 ;; esac
	[ "$UP_PORT" -ge 1 ] && [ "$UP_PORT" -le 65535 ] || return 1
	[ "$UP_KIND" != plain ] || valid_ipv4 "$UP_HOST"
}

# server_lua <pool> <order> <ip>: dnsdist newServer line for the upstream last read by parse_upstream
server_lua() {
	printf 'newServer({address=%s, pool=%s, order=%s, checkInterval=30' "$(lua_str "$3:$UP_PORT")" "$(lua_str "$1")" "$2"
	[ "$UP_KIND" = plain ] ||
		printf ', tls="openssl", subjectName=%s, validateCertificates=true, caStore="/etc/ssl/certs/ca-certificates.crt"' "$(lua_str "$UP_HOST")"
	[ "$UP_KIND" != doh ] || printf ', dohPath=%s' "$(lua_str "$UP_PATH")"
	printf '})\n'
}

# mobileconfig: Apple DNS-over-TLS profile from MC_NAME MC_CLIENT_ID MC_DOMAIN MC_IP MC_FAILOVER MC_UUID1 MC_UUID2
mobileconfig() {
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
		</dict>
	</array>
	<key>PayloadDisplayName</key>
	<string>$name DNS</string>
	<key>PayloadIdentifier</key>
	<string>familydns.$(xml_escape "$MC_CLIENT_ID")</string>
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

# blocklist_url <preset>: where a preset list comes from (empty for an unknown preset)
blocklist_url() {
	case "$1" in
		hagezi-light) echo "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/wildcard/light-onlydomains.txt" ;;
		hagezi) echo "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/wildcard/multi-onlydomains.txt" ;;
		hagezi-pro) echo "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/wildcard/pro-onlydomains.txt" ;;
		stevenblack) echo "https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts" ;;
	esac
}

# normalize_blocklist: any common list format on stdin (domains, hosts files, simple adblock rules,
# *.domain wildcards) -> one lowercase domain per line, sorted and unique, on stdout
normalize_blocklist() {
	awk '
		# Fast path: most lines of a domain list are already clean (the slow path is ~10x dearer on the router)
		/^#/ { next }
		/^[a-z0-9][a-z0-9.-]*\.[a-z0-9-]+$/ && !/^[0-9.]+$/ && $0 != "localhost.localdomain" { print; next }
		{
			line = tolower($0)
			sub(/\r$/, "", line)
			sub(/[ \t]*[#!;].*$/, "", line)
			if (line ~ /^[ \t]*$/ || line ~ /^@@/ || line ~ /[\/:]/) next
			n = split(line, f, /[ \t]+/)
			d = f[n]
			if (n >= 2 && f[1] !~ /^[0-9.]+$/ && f[1] !~ /^::/) next
			sub(/^\|\|/, "", d)
			sub(/\^.*$/, "", d)
			sub(/^\*\./, "", d)
			sub(/\.$/, "", d)
			if (d ~ /^[a-z0-9]([a-z0-9_-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9_-]*[a-z0-9])?)+$/ && d !~ /^[0-9.]+$/ && d !~ /^(localhost|localhost\.localdomain|broadcasthost|local)$/)
				print d
		}' | sort -u
}
