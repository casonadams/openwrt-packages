# luci-app-familydns

Give each family device its own DNS profile, reachable from anywhere over DNS-over-TLS. Phones keep your router's filtering on cellular and public Wi-Fi. A profile is a list of upstream resolvers (the defaults use CleanBrowsing's family filter for kids and its adult filter for adults), so the filtering is whatever the upstream does.

How it works: a DuckDNS name keeps pointing at your router, Let's Encrypt issues a wildcard certificate for it, and [dnsdist](https://dnsdist.org) serves DNS-over-TLS on port 853. Each device uses `<device-id>.<your-name>.duckdns.org`; dnsdist reads that hostname from the TLS handshake (SNI) and sends the query to the device's profile. iPhones install a generated `.mobileconfig`; on a supervised iPhone the profile can be locked so it can't be removed.

Install: see the [repository README](../README.md#install). `dnsmasq` stays the DHCP server and answers local names; dnsdist listens on port 5300 plus public DoT on 853. With *Use Family DNS for this network's DNS* on, LAN port 53 is redirected to dnsdist, so devices without a profile use the network profile. A leftover AdGuard Home from an earlier version is stopped and disabled on the next setup or reconcile; remove it with `apk del adguardhome`.

## Set up

1. Create a DuckDNS name and note its token.
2. **Services → Family DNS**: enter the domain (`<name>.duckdns.org`), token and email, tick *Enabled*, **Save & Apply**, then **Set up / Repair**. Certificate issuance takes about two minutes.
3. Pick **Profiles** (each is a list of upstream servers, one per entry: `https://host/path` for DoH, `tls://host[:port]` for DoT, or a plain IPv4 address; at least one is required), then add **Devices** (a name, an id such as `kid1`, and a profile), **Save & Apply**, then **Install profile** and AirDrop the file to the device.

dnsdist has no web UI. The generated configuration is `/etc/dnsdist.conf` (rewritten on every reconcile); logs are in `logread -e dnsdist`.

## Notes

- **Rate limit:** each client address is limited on its own, default 500 queries/s (*Queries per second per device*; 0 turns it off).
- **Failover:** a profile uses its first upstream and moves to the next one when it is down. *Fallback DNS servers* (default: CleanBrowsing's family filter plus its plain-IP resolver) are tried last, after every upstream of the profile, so a dead profile server still resolves, safely but without your extra filters. That covers a dead upstream. If the router or the DoT port itself is unreachable, generated profiles set `AllowFailover` (iOS 26 and later) so the iPhone uses the network's own DNS instead of losing resolution; that fallback is the network's resolver, so it is not filtered. Turn it off with *Let iPhones fall back to the network DNS*.
- Port 853/TCP is opened on the WAN; nothing else is. Device ids act like secrets: a device only gets its profile if it knows its hostname. Queries from outside the LAN with an unknown hostname are refused; on the LAN they get the network profile.
- A locked profile only prevents removal on supervised iPhones (Apple Configurator or MDM).
- If your upstream filter blocks `duckdns.org`, setup adds a narrow `dnsmasq` rule for `www.duckdns.org` only; removing the package takes it out.
- Requires a reachable public IPv4 address (no CGNAT) and a DuckDNS account.

## Development

```bash
sh tests/run.sh   # unit tests, UI tests, and a containerised run against a real dnsdist (docker + network)
```

See [`AGENTS.md`](AGENTS.md) for the architecture.

## Notes on upstreams

- DoH and DoT hostnames are resolved by the router when the config is rendered (hourly and on every change) and the last good address is kept, so a short DNS outage does not empty a profile. Plain upstreams must be IPv4 addresses.
- dnsdist validates the upstream's certificate against `/etc/ssl/certs/ca-certificates.crt`.
- Memory: dnsdist stays around 10-15 MB. There is no query log or statistics store.
