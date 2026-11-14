# Engineering Standards: `luci-app-screentime`

Package-specific rules; repository-wide rules are in the root `AGENTS.md`.

## 1. Target Environment

- **Reference hardware**: Ubiquiti EdgeRouter X (MIPS MT7621, 256 MB RAM) at `192.168.1.1`.
- **Target OS**: OpenWrt 25.12+ with `firewall4` (nftables), `conntrack` and `dnsmasq`; packaged as a `noarch` apk (shell, awk and JavaScript only, nothing compiled).

---

## 2. Package Layout

```text
luci-app-screentime/
├── Makefile                    # OpenWrt/LuCI package spec (PKG_VERSION is bumped by release-please)
├── version.txt, CHANGELOG.md   # Maintained by release-please
├── postinst, prerm             # apk post-install/post-upgrade and pre-deinstall scripts
├── README.md, AGENTS.md
├── tests/                      # run.sh runs everything; see tests/*.sh and test_ui.js
├── htdocs/luci-static/resources/
│   ├── view/screentime/overview.js   # LuCI view (GridSection + modal)
│   └── screentime/format.js          # Pure formatting/banner helpers (unit-tested)
└── root/
    ├── etc/init.d/screentime         # procd service: installs the per-minute cron, reconciles
    ├── etc/hotplug.d/ntp/99-screentime
    ├── etc/uci-defaults/99_screentime
    └── usr/
        ├── bin/screentime            # Engine: applies decisions as an nft set, flushes conntrack
        └── share/
            ├── screentime/decide.awk      # "Is this device allowed now?" (single source of truth)
            ├── screentime/default.config  # Copied to /etc/config/screentime on first install only
            ├── luci/menu.d/luci-app-screentime.json
            └── rpcd/acl.d/luci-app-screentime.json
```

---

## 3. UI/UX Rules & Constraints (`overview.js`)

1. **Model A Layout (`form.GridSection` + Modal)**:
   - **Main Overview**: Renders a compact 4-column summary table (`Enable`, `Schedule Window`, `Applies To`, `Actions: Edit/Delete`) that fits effortlessly on small mobile screens (360px–480px) with zero horizontal overflow.
   - **Modal Editing**: Tapping `[ Edit ]` opens LuCI's native modal dialog, providing generous full-width touch controls for Days of Week (`[M] [T] [W] [T] [F] [S] [S]`), 12-hour time dropdowns (`HH:MM AM/PM`), duration, and target device selection.
2. **Bottom Action Buttons (stock LuCI flow, no overrides)**:
   - Do NOT replace `handleSave`/`handleSaveApply`/`handleReset` (the view's `handleSave` only flags blank-row pruning and calls the stock one). LuCI stages changes through session-scoped ubus `uci` calls; a CLI `uci commit` (e.g. via `file exec`) cannot see them, so the "Unsaved Changes" banner never clears and nothing reaches disk.
   - **`[ Save & Apply ]`** runs stock `ui.changes.apply()` (commit + `reload_config`). The procd reload trigger on the `screentime` config then runs `/usr/bin/screentime reconcile`.
   - **`[ Save ]`** stages only; **`[ Reset ]`** reverts staged changes.
   - Managed Devices rows with an empty MAC are pruned on save (`mac` option `write` removes the section).
3. **State Header, Schedule Status and Device Status**:
   - Everything shown comes from `screentime status --json` (fetched on load, after each action, and every 30 s). The UI never recomputes schedule logic.
   - Header: router clock, plus `Screen Time is off` when disabled. There is no global override.
   - Each schedule row (in the `Schedule Window` cell) shows green `Open until <time>`, red `Downtime until <time>`, or amber `... (override)`, and one button: `Ignore Downtime` (closed) / `Turn On Downtime` (open) / `Resume Schedule` (override active). Buttons run the engine with the schedule's section id; they never stage UCI changes.
   - New schedules get a named section (`sched_<hex>`, `handleAdd`): overrides are keyed by section name, and anonymous section names are positional.
   - Managed Devices table has a read-only per-device `Status` column fed from the same JSON.

---

## 4. Backend Engine Rules (`/usr/bin/screentime`)

- **POSIX Shell Only**: Shell scripts must run on BusyBox ash (`/bin/sh`). No bashisms, no arrays, no `[[ ]]`.
- **One decision function**: `decide.awk` reads `uci show screentime` and answers per-device allowed/blocked, next change and JSON. Enforcement and UI both use it; do not duplicate window logic in shell or JS. A window belongs to its start day and may cross midnight. `duration` is the only end-time source.
- **Enforcement**: a private nft table `inet screentime` (set `blocked`, forward hook at priority -1, `reject`), replaced atomically with `nft -f`. `firewall4` and `/etc/config/firewall` are never touched. No schedules or an unlisted device means blocked 24/7.
- **Reconcile**: cron runs `screentime reconcile` every minute and the ntp hotplug runs it when the clock syncs. It is idempotent and skips while the clock is before 2023 (NTP not synced).
- **Overrides**: per schedule. `/etc/screentime.override` holds one `<schedule section> <ignore|forced> <until epoch>` line per schedule; `until` is that schedule's own next window open (ignore) or close (forced), so a missed cron or reboot cannot leave it stuck. An override replaces only its schedule's state; a device is allowed when any schedule covering it is open. Disabled, deleted or anonymous schedules cannot hold an override; `uci-defaults` names existing anonymous schedules.
- **Conntrack Flushing**: only devices that just became blocked are flushed, IPv4 and IPv6 (addresses from dhcp.leases and `ip neigh`).
- **Testing hooks**: `SCREENTIME_CLOCK="<dow> <secs> <epoch>"` fakes the clock; `OVERRIDE_FILE`, `STATE_FILE`, `LOCK_DIR`, `LEASES_FILE` and `SCREENTIME_DECIDE` redirect state for tests.

---

## 5. Live Router Testing & Deployment

Direct live-testing commands against `root@192.168.1.1` (run from this directory):

```bash
# Push view changes to live router (use -O for Dropbear legacy scp)
scp -O htdocs/luci-static/resources/view/screentime/overview.js root@192.168.1.1:/www/luci-static/resources/view/screentime/overview.js

# Push engine and decision function to live router
scp -O root/usr/bin/screentime root@192.168.1.1:/usr/bin/screentime
scp -O root/usr/share/screentime/decide.awk root@192.168.1.1:/usr/share/screentime/decide.awk
scp -O htdocs/luci-static/resources/screentime/format.js root@192.168.1.1:/www/luci-static/resources/screentime/format.js

# Push procd init script to live router
scp -O root/etc/init.d/screentime root@192.168.1.1:/etc/init.d/screentime

# Restart rpcd and flush LuCI cache
ssh root@192.168.1.1 "rm -rf /tmp/luci-* /var/luci-*; /etc/init.d/rpcd restart"

# Verify engine status and state on router
ssh root@192.168.1.1 "/usr/bin/screentime status"
```

## Form rules

- Form validation rules (blank input, no `required`, pruning blank rows) are in the root `AGENTS.md` section 5; `tests/test_ui.js` enforces them.
