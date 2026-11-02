# luci-app-familydns

Give each family device its own DNS profile, reachable from anywhere over DNS-over-TLS. Phones keep your router's filtering on cellular and public Wi-Fi. A profile is a list of upstream resolvers (the defaults use CleanBrowsing's family filter for kids and its adult filter for adults), so the filtering is whatever the upstream does.

How it works: a DuckDNS name keeps pointing at your router, Let's Encrypt issues a wildcard certificate for it, and [dnsdist](https://dnsdist.org) serves DNS-over-TLS on port 853. Each device uses `<device-id>.<your-name>.duckdns.org`; dnsdist reads that hostname from the TLS handshake (SNI) and sends the query to the device's profile. iPhones install a generated `.mobileconfig`.

Install: see the [repository README](../README.md#install). `dnsmasq` stays the DHCP server and answers local names; dnsdist listens on port 5300 plus public DoT on 853. With *Use Family DNS for this network's DNS* on, LAN port 53 is redirected to dnsdist, so devices without a profile use the network profile. A leftover AdGuard Home from an earlier version is stopped and disabled on the next setup or reconcile; remove it with `apk del adguardhome`.

## Set up

1. Create a DuckDNS name and note its token.
2. **Services → Family DNS → Connection → Edit**: enter the domain (`<name>.duckdns.org`), token and email, tick *Enabled*, **Save & Apply**, then **Set up / Repair**. Certificate issuance takes about two minutes.
3. Pick **Profiles** (each is a list of upstream servers, one per entry: `https://host/path` for DoH, `tls://host[:port]` for DoT, or a plain IPv4 address; at least one is required), then add **Devices** (a name and a profile), **Save & Apply**, then **Install profile** and AirDrop the file to the device.

The Devices table has *Queries* and *Blocked* columns. The first row, *Everyone else*, is the default path: every device on the network that is not listed. It cannot be removed, but you can pick its profile and switch network filtering on or off. *Blocked* counts answers saying the name does not exist: that is how CleanBrowsing's filters block a site, but a mistyped name counts too. The counts come from dnsdist's rule counters and restart from zero whenever dnsdist restarts (any config change or certificate renewal); there is no query log. dnsdist has no web UI of its own. The generated configuration is `/etc/dnsdist.conf` (rewritten on every reconcile); logs are in `logread -e dnsdist`.

## Notes

- **Rate limit:** each client address is limited on its own, default 500 queries/s (*Queries per second per device*; 0 turns it off).
- **Failover:** a profile uses its first upstream and moves to the next one when it is down. *Fallback DNS servers* (default: CleanBrowsing's family filter plus its plain-IP resolver) are tried last, after every upstream of the profile, so a dead profile server still resolves, safely but without your extra filters. That covers a dead upstream. If the router or the DoT port itself is unreachable, generated profiles set `AllowFailover` (iOS 26 and later) so the iPhone uses the network's own DNS instead of losing resolution; that fallback is the network's resolver, so it is not filtered. Turn it off with *Let iPhones fall back to the network DNS*.
- Port 853/TCP is opened on the WAN; nothing else is. A device's DNS hostname is its name plus a random suffix (for example `landon-s-ipad-1a2b.your-name.duckdns.org`), generated when the device is first saved and kept when you rename it; it acts like a secret, because a device only gets its profile if it knows its hostname. Queries from outside the LAN with an unknown hostname are refused; on the LAN they get the network profile.
- If your upstream filter blocks `duckdns.org`, setup adds a narrow `dnsmasq` rule for `www.duckdns.org` only; removing the package takes it out.
- Requires a reachable public IPv4 address (no CGNAT) and a DuckDNS account.

## Development

```bash
sh tests/run.sh   # unit tests, UI tests, and a containerised run against a real dnsdist (docker + network)
```

See [`AGENTS.md`](AGENTS.md) for the architecture.

## Ad blocking

One list is shared by every device and by the network default. Names on it get an NXDOMAIN answer from the router, before any upstream is asked, and they count in the *Blocked* column. Pick the list under **Ad blocking**; the default is [HaGeZi](https://github.com/hagezi/dns-blocklists) *Multi Normal* (about 176,000 domains, balanced). *Light* has the fewest wrong blocks, *Pro* is stricter, and [StevenBlack](https://github.com/StevenBlack/hosts)'s unified hosts list is the older, smaller alternative. A list of your own can be any hosts file, plain list of domains or simple adblock rules over http(s).

- **Always block** and **Never block** take your own domains (with their subdomains). Never block wins over the list and over Always block; Always block works even with the list switched off.
- The list is downloaded the first time it is needed and again every night at 04:41 (`familydns lists update`; *Update now* does the same). Dnsdist restarts when the list changed, about two seconds of no DNS.
- Memory: dnsdist holds the list in a Lua table, roughly 150 bytes a domain (about 25 MB on top of its 12 MB for the largest list). The normalised list is stored in `/etc/familydns/blocklist.txt`.
- An unreachable list address, or a download that is clearly not a list, keeps the previous list.

## Notes on upstreams

- Find provider addresses in AdGuard's [DNS providers list](https://adguard-dns.io/kb/general/dns-providers/). Use its DNS-over-HTTPS (`https://...`) or DNS-over-TLS (`tls://...`) address, or a plain IPv4 address; `quic://` and `sdns://` entries are not supported.
- DoH and DoT hostnames are resolved by the router when the config is rendered (hourly and on every change) and the last good address is kept, so a short DNS outage does not empty a profile. Plain upstreams must be IPv4 addresses.
- dnsdist validates the upstream's certificate against `/etc/ssl/certs/ca-certificates.crt`.
- Memory: dnsdist stays around 10-15 MB. There is no query log or statistics store.
- A device's count includes its DoT queries (by hostname) and plain queries from its *LAN address*; a LAN device without an address set is counted under the default path.
