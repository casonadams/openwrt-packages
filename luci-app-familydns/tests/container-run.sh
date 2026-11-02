#!/bin/sh
# Runs inside an OpenWrt rootfs container (see test_integration.sh). Phase is $1.
# Upstreams are local dnsmasq instances that answer who.test with a different address each, so the
# test can tell which upstream a query went to.
PKG=/pkg
export STATE_DIR=/etc/familydns DNSDIST_CONF=/etc/dnsdist.conf
LAN_IP=$(ip -4 -o addr show eth0 | awk '{print $4}' | cut -d/ -f1)
export LAN_IP

load_engine() {
	sed '/^case "\$1" in/,$d' /usr/bin/familydns > /tmp/engine.sh
	# shellcheck source=/dev/null
	. /tmp/engine.sh
	# No procd in the container: run dnsdist directly where the engine would restart the service.
	dnsdist_restart() {
		# shellcheck disable=SC2046
		kill $(pidof dnsdist) 2>/dev/null
		sleep 1
		dnsdist --supervised -C "$DNSDIST_CONF" -u dnsdist -g dnsdist >/tmp/dnsdist.log 2>&1 &
	}
}

fake_upstream() {
	dnsmasq --conf-file=/dev/null --port="$1" --listen-address=127.0.0.1 --bind-interfaces --no-resolv --no-hosts \
		--address="/who.test/$2" --address=/blocked.test/ --pid-file="/tmp/dnsmasq-$1.pid"
}

case "$1" in
setup)
	apk update >/dev/null 2>&1
	apk add dnsdist openssl-util >/dev/null 2>&1 || { echo "FAIL apk add"; exit 1; }
	cp -r "$PKG/root/." /
	cp /usr/share/familydns/default.config /etc/config/familydns
	uci set familydns.settings.enabled=1
	uci set familydns.settings.domain=test.duckdns.org
	uci set familydns.settings.duckdns_token=unused
	uci set familydns.settings.email=ci@example.com
	uci -q delete familydns.kids.upstream
	uci -q delete familydns.adult.upstream
	uci add_list familydns.kids.upstream=127.0.0.1:5391
	uci add_list familydns.adult.upstream=127.0.0.1:5392
	uci set familydns.broken=profile
	uci set familydns.broken.name=Broken
	uci add_list familydns.broken.upstream=127.0.0.1:9
	uci -q delete familydns.settings.fallback
	uci add_list familydns.settings.fallback=127.0.0.1:5393
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
	fake_upstream 5391 10.0.0.1
	fake_upstream 5392 10.0.0.2
	fake_upstream 5393 10.0.0.3
	dnsmasq --conf-file=/dev/null --port=53 --listen-address=127.0.0.1 --bind-interfaces --no-resolv --no-hosts \
		--address=/router.lan/192.168.1.1 --pid-file=/tmp/dnsmasq-53.pid
	mkdir -p /etc/ssl/acme
	openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 2 \
		-keyout "/etc/ssl/acme/*.test.duckdns.org.key" -out "/etc/ssl/acme/*.test.duckdns.org.fullchain.crt" \
		-subj "/CN=*.test.duckdns.org" -addext "subjectAltName=DNS:*.test.duckdns.org" >/dev/null 2>&1
	cp "/etc/ssl/acme/*.test.duckdns.org.fullchain.crt" /tmp/ca.crt
	load_engine
	if stage_dnsdist; then echo "OK dnsdist: $MSG"; else echo "FAIL dnsdist: $MSG"; tail -5 /tmp/dnsdist.log; exit 1; fi
	if stage_firewall; then echo "OK firewall: $MSG"; fi
	sleep 3
	;;
lan)
	load_engine
	uci set familydns.everyone.enabled=1
	uci commit familydns
	if stage_lan; then echo "OK lan: $MSG"; else echo "FAIL lan: $MSG"; fi
	echo "redirect: '$(uci -q get firewall.familydns_lan_dns)' to port '$(uci -q get firewall.familydns_lan_dns.dest_port)' proto '$(uci -q get firewall.familydns_lan_dns.proto)'"
	;;
lan-off)
	load_engine
	uci set familydns.everyone.enabled=0
	uci commit familydns
	if stage_lan; then echo "OK lan: $MSG"; else echo "FAIL lan: $MSG"; fi
	echo "redirect after off: '$(uci -q get firewall.familydns_lan_dns)'"
	;;
status) familydns status ;;
profile) familydns profile kid1 ;;
resync)
	load_engine
	uci delete "familydns.@device[2]"
	uci commit familydns
	apply_dnsdist
	sleep 3
	echo "dad rule after removal: $(grep -c 'SNIRule("dad.test.duckdns.org")' "$DNSDIST_CONF")"
	;;
teardown)
	load_engine
	familydns teardown
	echo "firewall rule: '$(uci -q get firewall.familydns_dot)'"
	echo "state dir exists: $([ -d /etc/familydns ] && echo yes || echo no)"
	echo "dnsdist enabled: '$(uci -q get dnsdist.general.enabled)'"
	echo "dnsdist config size: $(wc -c < "$DNSDIST_CONF" | tr -d ' ')"
	;;
esac
