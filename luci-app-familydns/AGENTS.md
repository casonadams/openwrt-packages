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

- **Engine = POSIX shell (BusyBox ash)**, `shellcheck -x -s sh` clean. Pure helpers (escaping, ids, client JSON, profile XML, date maths) live in `lib.sh` and are unit-tested; stage code in `bin/familydns` is tested against a real AdGuard Home in a container.
- **Stages are idempotent**: `ddns -> cert -> agh -> firewall -> clients`. Each prints one `MSG`, records progress in `/tmp/familydns.progress`, and may be re-run any time (`reconcile` re-runs the cheap ones hourly).
- **AdGuard Home is configured only through its own API** (`/control/install/configure`, `/control/tls/configure`, `/control/clients/*`), never by editing its YAML. The wizard owns port 3000, so the admin UI uses `web_port` (3001) on the LAN address; plain DNS is on 5300; DoT on `dot_port`; HTTPS/DoH is disabled (`port_https` 0) so the admin UI is never exposed on the WAN.
- **Certificates**: a wildcard-only cert for `*.<domain>` via acme.sh DNS-01 (DuckDNS allows one TXT record, so apex + wildcard cannot validate together). `dns_wait` is set because filtering upstream resolvers hide the TXT record from acme.sh's own check, and acme options only apply on a fresh issue, so changing settings removes the old state and re-issues. The cert is copied to `/etc/adguardhome/tls` (owned by `adguardhome`) and AdGuard Home is restarted when it changes.
- **Secrets** (DuckDNS token) live only in root-only UCI (`familydns`, `ddns`, `acme`), never in the repo or logs. Tests use documentation names (`example.duckdns.org`, `test.duckdns.org`, `203.0.113.x`).
- **Teardown** removes what bootstrap created (firewall rule, ddns/acme sections, the `www.duckdns.org` dnsmasq rule, managed AdGuard Home clients) and leaves AdGuard Home and its config alone.
- Testing hooks: `UCI_CONFIG_DIR`, `FAMILYDNS_LIB`, `AGH_DIR`, `AGH_WEB_IP`, `ACME_SSL`, `STATE_DIR`, `PROGRESS_FILE`, `PID_FILE`.

## Live router

```bash
scp -O root/usr/bin/familydns root@192.168.1.1:/usr/bin/familydns
scp -O root/usr/share/familydns/lib.sh root@192.168.1.1:/usr/share/familydns/lib.sh
scp -O htdocs/luci-static/resources/view/familydns/overview.js root@192.168.1.1:/www/luci-static/resources/view/familydns/overview.js
scp -O htdocs/luci-static/resources/familydns/format.js root@192.168.1.1:/www/luci-static/resources/familydns/format.js
ssh root@192.168.1.1 "familydns status"
```
