#!/bin/sh
# Runs inside an OpenWrt rootfs container (see test_integration.sh). Phase is $1.
PKG=/pkg
export AGH_WEB_IP=127.0.0.1 AGH_DIR=/etc/adguardhome STATE_DIR=/etc/familydns

load_engine() {
	sed '/^case "\$1" in/,$d' /usr/bin/familydns > /tmp/engine.sh
	# shellcheck source=/dev/null
	. /tmp/engine.sh
}

case "$1" in
setup)
	apk update >/dev/null 2>&1
	apk add adguardhome openssl-util >/dev/null 2>&1 || { echo "FAIL apk add"; exit 1; }
	cp -r "$PKG/root/." /
	cp /usr/share/familydns/default.config /etc/config/familydns
	uci set familydns.settings.enabled=1
	uci set familydns.settings.domain=test.duckdns.org
	uci set familydns.settings.duckdns_token=unused
	uci set familydns.settings.email=ci@example.com
	uci -q delete familydns.kids.upstream
	uci -q delete familydns.adult.upstream
	uci add_list familydns.kids.upstream=1.0.0.1
	uci set familydns.broken=profile
	uci set familydns.broken.name=Broken
	uci set familydns.broken.filtering=0
	uci add_list familydns.broken.upstream=127.0.0.1:9
	uci -q delete familydns.settings.fallback
	uci add_list familydns.settings.fallback=9.9.9.9
	for d in "Kid One|kid1|kids" "Dad|dad|adult" "Kid Two|kid2|broken"; do
		IFS='|' read -r n i p <<EOT
$d
EOT
		s=$(uci add familydns device)
		uci set "familydns.$s.name=$n"
		uci set "familydns.$s.client_id=$i"
		uci set "familydns.$s.profile=$p"
	done
	uci commit familydns
	mkdir -p /etc/ssl/acme /etc/adguardhome /var/lib/adguardhome
	openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 2 \
		-keyout "/etc/ssl/acme/*.test.duckdns.org.key" -out "/etc/ssl/acme/*.test.duckdns.org.fullchain.crt" \
		-subj "/CN=*.test.duckdns.org" -addext "subjectAltName=DNS:*.test.duckdns.org" >/dev/null 2>&1
	cp "/etc/ssl/acme/*.test.duckdns.org.fullchain.crt" /tmp/ca.crt
	AdGuardHome --no-check-update -c /etc/adguardhome/adguardhome.yaml -w /var/lib/adguardhome >/tmp/agh.log 2>&1 &
	sleep 5
	load_engine
	install_cert
	if stage_agh; then echo "OK agh: $MSG"; else echo "FAIL agh: $MSG"; tail -5 /tmp/agh.log; exit 1; fi
	agh_post /control/dns_config '{"upstream_dns":["1.1.1.1"],"bootstrap_dns":["1.1.1.1"]}' >/dev/null
	agh_post /control/filtering/refresh '{"whitelist":false}' >/dev/null
	if stage_firewall; then echo "OK firewall: $MSG"; fi
	if stage_clients; then echo "OK clients: $MSG"; else echo "FAIL clients: $MSG"; exit 1; fi
	n=0
	while [ "$n" -lt 45 ]; do
		rules=$(agh_get /control/filtering/status | jsonfilter -e '@.filters[0].rules_count')
		[ "${rules:-0}" -gt 0 ] && break
		n=$((n + 1)); sleep 2
	done
	echo "OK rules: ${rules:-0}"
	[ "${rules:-0}" -gt 0 ] || grep -i error /tmp/agh.log | tail -3 | cut -c1-300
	;;
lan)
	load_engine
	uci set familydns.settings.lan_dns=1
	uci set familydns.settings.lan_profile=kids
	uci commit familydns
	if stage_lan; then echo "OK lan: $MSG"; else echo "FAIL lan: $MSG"; fi
	echo "safesearch: $(agh_get /control/safesearch/status | jsonfilter -e '@.enabled')"
	echo "parental: $(agh_get /control/parental/status | jsonfilter -e '@.enabled')"
	echo "safebrowsing: $(agh_get /control/safebrowsing/status | jsonfilter -e '@.enabled')"
	echo "ptr: $(agh_get /control/dns_info | jsonfilter -e '@.local_ptr_upstreams[*]' | tr '\n' ' ')"
	echo "lan rule count: $(agh_get /control/dns_info | jsonfilter -e '@.upstream_dns[*]' | grep -c '^\[/lan/\]127.0.0.1:53$')"
	echo "redirect: '$(uci -q get firewall.familydns_lan_dns)' to port '$(uci -q get firewall.familydns_lan_dns.dest_port)' proto '$(uci -q get firewall.familydns_lan_dns.proto)'"
	stage_lan >/dev/null
	echo "lan rule count after a second run: $(agh_get /control/dns_info | jsonfilter -e '@.upstream_dns[*]' | grep -c '^\[/lan/\]127.0.0.1:53$')"
	;;
lan-off)
	load_engine
	uci set familydns.settings.lan_dns=0
	uci commit familydns
	if stage_lan; then echo "OK lan: $MSG"; else echo "FAIL lan: $MSG"; fi
	echo "redirect after off: '$(uci -q get firewall.familydns_lan_dns)'"
	;;
status) familydns status ;;
profile) familydns profile kid1 --lock ;;
querylog)
	load_engine
	agh_get '/control/querylog?limit=20' | jsonfilter -e '@.data[*].client_id' | tr '\n' ' '
	echo
	echo "kid1 upstream: $(agh_get '/control/querylog?limit=20&search=example.com' | jsonfilter -e '@.data[@.client_id="kid1"].upstream' | head -1)"
	echo "kid2 upstream: $(agh_get '/control/querylog?limit=20&search=example.net' | jsonfilter -e '@.data[@.client_id="kid2"].upstream' | head -1)"
	echo "dad upstream: $(agh_get '/control/querylog?limit=20&search=example.org' | jsonfilter -e '@.data[@.client_id="dad"].upstream' | head -1)"
	;;
resync)
	load_engine
	uci delete "familydns.@device[1]"
	uci commit familydns
	stage_clients
	echo "dad client name after removal: '$(agh_client_name_for dad)'"
	echo "kid1 client name still present: '$(agh_client_name_for kid1)'"
	echo "managed: $(tr '\n' ' ' < /etc/familydns/managed)"
	;;
teardown)
	load_engine
	familydns teardown
	echo "kid1 after teardown: '$(agh_client_name_for kid1)'"
	echo "state dir exists: $([ -d /etc/familydns ] && echo yes || echo no)"
	echo "firewall rule: '$(uci -q get firewall.familydns_dot)'"
	;;
esac
