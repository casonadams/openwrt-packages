# Engineering Standards: `luci-app-familydns`

Package-specific rules; repository-wide rules are in the root `AGENTS.md`.

## Layout

```text
luci-app-familydns/
├── Makefile, version.txt, CHANGELOG.md   # release-please maintained version
├── postinst, prerm                       # apk post-install/upgrade and pre-deinstall
├── tests/                                # run.sh; test_unit.sh, test_ui.js, test_integration.sh (+ container-run.sh, dot_query.py)
├── htdocs/luci-static/resources/
│   ├── view/familydns/overview.js        # LuCI view
│   └── familydns/format.js               # pure helpers (unit-tested)
└── root/
    ├── etc/init.d/familydns              # hourly cron + reconcile on config change
    ├── etc/uci-defaults/99_familydns     # seeds /etc/config/familydns from default.config (not a conffile)
    └── usr/
        ├── bin/familydns                 # engine: stages, status, reconcile, profile, teardown
        └── share/{familydns/{lib.sh,default.config}, luci/menu.d, rpcd/acl.d}
```

## Rules

- Form validation rules (blank input, no `required`, pruning blank rows) are in the root `AGENTS.md` section 5; `tests/test_ui.js` enforces them.
- **Engine = POSIX shell (BusyBox ash)**, `shellcheck -x -s sh` clean. Pure helpers (escaping, ids, upstream parsing, dnsdist server lines, profile XML, date maths) live in `lib.sh` and are unit-tested; the config renderer is unit-tested with a fake `uci`/`resolveip`, and the stage code is tested against a real dnsdist in a container.
- **Stages are idempotent**: `ddns -> cert -> dnsdist -> firewall -> lan`. Each prints one `MSG`, records progress in `/tmp/familydns.progress`, and may be re-run any time (`reconcile` re-runs the cheap ones hourly).
- **dnsdist is configured only by rendering `/etc/dnsdist.conf`** (`render_dnsdist`), never by hand. `apply_dnsdist` renders to `.new`, runs `dnsdist --check-config`, and restarts the stock `/etc/init.d/dnsdist` only when the config or the certificate changed, so a bad render never replaces a working config. Plain DNS is on 5300 (loopback and the LAN address), DoT on `dot_port`; the only HTTP surface is dnsdist's API on `127.0.0.1:8083` (`WEB_PORT`), keyed by `STATE_DIR/api.key`, which is why `/etc/dnsdist.conf` is mode 600. Profiles become dnsdist pools named after the UCI section; each upstream is a server with `order` (profile upstreams first, then `fallback`) under `setServerPolicy(firstAvailable)`. Upstream hostnames are resolved with `resolveip` at render time (dnsdist needs addresses) and the last good answer is cached in `STATE_DIR/resolved`. Keep `setMaxUDPOutstanding(1024)`: the default preallocates about 20 MB per server on this 256 MB router.
- **Counters**: every `addAction` is named (`limited`, `refused`, `local`, `dev:<client id>` for both of a device's rules, `default`) so `rule_counts` can read `matches` per name from `/api/v1/servers/localhost` (dnsdist prints keys alphabetically, so `matches` is directly followed by `name`; an unnamed rule would still parse but could not be attributed). `status` returns `devices[].queries` and `queries.default`, `null` when the API does not answer.
- **Routing order** (`emit_routes`): rate limit, refuse non-LAN sources whose SNI is not a known device, local names to dnsmasq (`127.0.0.1:53`), per-device SNI and LAN-address rules, then the network profile for everything else.
- **Certificates**: a wildcard-only cert for `*.<domain>` via acme.sh DNS-01 (DuckDNS allows one TXT record, so apex + wildcard cannot validate together). `dns_wait` is set because filtering upstream resolvers hide the TXT record from acme.sh's own check, and acme options only apply on a fresh issue, so changing settings removes the old state and re-issues. dnsdist reads the cert in place from `/etc/ssl/acme` (as root, before dropping to the `dnsdist` user) and is restarted when its checksum (`STATE_DIR/cert.sum`) changes.
- **Secrets** (DuckDNS token) live only in root-only UCI (`familydns`, `ddns`, `acme`), never in the repo or logs. Tests use documentation names (`example.duckdns.org`, `test.duckdns.org`, `203.0.113.x`).
- **Teardown** removes what bootstrap created (firewall rule, ddns/acme sections, the `www.duckdns.org` dnsmasq rule), stops and disables dnsdist and empties its config; the `dnsdist` package stays. Setup also stops and disables a leftover AdGuard Home (`retire_adguardhome`).
- Testing hooks: `UCI_CONFIG_DIR`, `FAMILYDNS_LIB`, `DNSDIST_CONF`, `DNS_PORT`, `LAN_IP`, `ACME_SSL`, `STATE_DIR`, `PROGRESS_FILE`, `PID_FILE`.

## Live router

```bash
scp -O root/usr/bin/familydns root@192.168.1.1:/usr/bin/familydns
scp -O root/usr/share/familydns/lib.sh root@192.168.1.1:/usr/share/familydns/lib.sh
scp -O htdocs/luci-static/resources/view/familydns/overview.js root@192.168.1.1:/www/luci-static/resources/view/familydns/overview.js
scp -O htdocs/luci-static/resources/familydns/format.js root@192.168.1.1:/www/luci-static/resources/familydns/format.js
ssh root@192.168.1.1 "familydns status"
```
