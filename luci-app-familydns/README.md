# luci-app-familydns

Give each family device its own [AdGuard Home](https://github.com/AdguardTeam/AdGuardHome) profile, reachable from anywhere over DNS-over-TLS. Phones keep your router's filtering on cellular and public Wi-Fi, and each device gets its own settings (kids: safe search, parental control, blocked apps; adults: ad blocking only).

How it works: a DuckDNS name keeps pointing at your router, Let's Encrypt issues a wildcard certificate for it, and AdGuard Home serves DNS-over-TLS on port 853. Each device uses `<device-id>.<your-name>.duckdns.org`; AdGuard Home reads that hostname as the device's ClientID and applies its profile. iPhones install a generated `.mobileconfig`; on a supervised iPhone the profile can be locked so it can't be removed.

Install: see the [repository README](../README.md#install). Your household DNS is not touched: the LAN keeps using `dnsmasq`, and AdGuard Home listens on port 5300 plus public DoT on 853.

## Set up

1. Create a DuckDNS name and note its token.
2. **Services → Family DNS**: enter the domain (`<name>.duckdns.org`), token and email, tick *Enabled*, **Save & Apply**, then **Set up / Repair**. Certificate issuance takes about two minutes.
3. Pick **Profiles** (each sets filters and, optionally, its own DNS servers; the defaults use Cloudflare's family endpoint for kids and the standard Cloudflare endpoint for adults), then add **Devices** (a name, an id such as `kid1`, and a profile), **Save & Apply**, then **Install profile** and AirDrop the file to the device.

The AdGuard Home admin UI is at `http://<router>:3001` (LAN only); its generated password is in `/etc/adguardhome/admin.pass`.

## Notes

- Port 853/TCP is opened on the WAN; nothing else is. Device ids act like secrets: a device only gets its profile if it knows its hostname, and unknown names still resolve with global settings.
- A locked profile only prevents removal on supervised iPhones (Apple Configurator or MDM).
- If your upstream filter blocks `duckdns.org`, setup adds a narrow `dnsmasq` rule for `www.duckdns.org` only; removing the package takes it out.
- Requires a reachable public IPv4 address (no CGNAT) and a DuckDNS account.

## Development

```bash
sh tests/run.sh   # unit tests, UI tests, and a containerised run against a real AdGuard Home (docker + network)
```

See [`AGENTS.md`](AGENTS.md) for the architecture.
