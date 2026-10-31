# Engineering Standards & Repository Guidelines: `openwrt-packages`

Repository instructions for `luci-app-screentime` and future OpenWrt packages.

---

## 1. Subsystem & Target Environment

- **Target Architecture**: Ubiquiti EdgeRouter X (MIPS MT7621, 256 MB RAM) at `192.168.1.1`.
- **Target OS**: OpenWrt 24.10+ / 25.12+ with `firewall4` (nftables), `conntrack`, `dnsmasq`, and `https-dns-proxy`.
- **Package Manager**: `apk-tools` (`.apk`) on OpenWrt 25+; `opkg` (`.ipk`) on legacy releases.

---

## 2. Directory Layout & Architecture

```text
openwrt-packages/
├── .github/workflows/
│   ├── build.yml               # CI: ShellCheck lint, test suite, and APK packaging
│   ├── pages.yml               # CD: Deploys APKv3 package repository to GitHub Pages
│   └── release.yml             # Release Please: automated tagging and GitHub Releases
├── AGENTS.md                   # This file (engineering rules & deployment guide)
├── README.md                   # Public documentation, CLI guide, screenshots
├── install.sh                  # One-line instant installer for OpenWrt
├── release-please-config.json  # Release-Please configuration
├── .release-please-manifest.json # Release-Please version manifest
├── scripts/
│   ├── build-apk.sh            # APKv3 ADB package assembler via apk mkpkg
│   └── generate-pages.sh       # Assembles GitHub Pages repo feed and landing page
├── tests/
│   ├── test_engine.sh          # Engine test suite (decision logic, overrides, reconcile)
│   └── test_ui.js              # Node tests for the pure UI formatting module
└── luci-app-screentime/
    ├── Makefile                # Standard OpenWrt LuCI package specification
    ├── htdocs/luci-static/resources/view/
    │   └── screentime/
    │       └── overview.js     # Client-side LuCI JavaScript Web UI (Model A: GridSection + modal)
    │   └── screentime/format.js  # Pure formatting/banner helpers (unit-tested by tests/test_ui.js)
    └── root/
        ├── etc/
        │   ├── config/
        │   │   └── screentime         # UCI configuration (schedules & devices)
        │   ├── init.d/
        │   │   └── screentime         # Procd init service (installs the per-minute cron, reconciles)
        │   └── uci-defaults/
        │       └── 99_screentime      # Post-install auto-enablement script
        └── usr/
            ├── bin/
            │   └── screentime         # Core shell engine: nftables rules, conntrack flush
            └── share/
                ├── screentime/decide.awk         # Single source of truth: "is this device allowed now?"
                ├── luci/menu.d/
                │   └── luci-app-screentime.json  # Menu entry: Services -> Screen Time
                └── rpcd/acl.d/
                    └── luci-app-screentime.json  # RPCD permissions (UCI, file exec)
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
3. **State Header and Device Status**:
   - Everything shown comes from `screentime status --json` (fetched on load, after each action, and every 30 s). The UI never recomputes schedule logic.
   - Banner: green `Allowed until <time>`, red `Downtime - next window opens <time>`, amber `Downtime ignored/forced until <time>`. Button: `Ignore Downtime Until Next Window` (in downtime) / `Turn On Downtime Now` (inside a window) / `Resume Schedule` (override active).
   - Managed Devices table has a read-only per-device `Status` column fed from the same JSON.

---

## 4. Backend Engine Rules (`/usr/bin/screentime`)

- **POSIX Shell Only**: Shell scripts must run on BusyBox ash (`/bin/sh`). No bashisms, no arrays, no `[[ ]]`.
- **One decision function**: `decide.awk` reads `uci show screentime` and answers per-device allowed/blocked, next change and JSON. Enforcement and UI both use it; do not duplicate window logic in shell or JS. A window belongs to its start day and may cross midnight. `duration` is the only end-time source.
- **Enforcement**: a private nft table `inet screentime` (set `blocked`, forward hook at priority -1, `reject`), replaced atomically with `nft -f`. `firewall4` and `/etc/config/firewall` are never touched. No schedules or an unlisted device means blocked 24/7.
- **Reconcile**: cron runs `screentime reconcile` every minute and the ntp hotplug runs it when the clock syncs. It is idempotent and skips while the clock is before 2023 (NTP not synced).
- **Overrides**: `/etc/screentime.override` holds `<ignore|forced> <expiry epoch>`; the expiry is the next global window open/close, so a missed cron or reboot cannot leave it stuck.
- **Conntrack Flushing**: only devices that just became blocked are flushed, IPv4 and IPv6 (addresses from dhcp.leases and `ip neigh`).
- **Testing hooks**: `SCREENTIME_CLOCK="<dow> <secs> <epoch>"` fakes the clock; `OVERRIDE_FILE`, `STATE_FILE`, `LOCK_DIR`, `LEASES_FILE` and `SCREENTIME_DECIDE` redirect state for tests.

---

## 5. Live Router Testing & Deployment

Direct live-testing commands against `root@192.168.1.1`:

```bash
# Push view changes to live router (use -O for Dropbear legacy scp)
scp -O luci-app-screentime/htdocs/luci-static/resources/view/screentime/overview.js root@192.168.1.1:/www/luci-static/resources/view/screentime/overview.js

# Push engine and decision function to live router
scp -O luci-app-screentime/root/usr/bin/screentime root@192.168.1.1:/usr/bin/screentime
scp -O luci-app-screentime/root/usr/share/screentime/decide.awk root@192.168.1.1:/usr/share/screentime/decide.awk
scp -O luci-app-screentime/htdocs/luci-static/resources/screentime/format.js root@192.168.1.1:/www/luci-static/resources/screentime/format.js

# Push procd init script to live router
scp -O luci-app-screentime/root/etc/init.d/screentime root@192.168.1.1:/etc/init.d/screentime

# Restart rpcd and flush LuCI cache
ssh root@192.168.1.1 "rm -rf /tmp/luci-* /var/luci-*; /etc/init.d/rpcd restart"

# Verify engine status and state on router
ssh root@192.168.1.1 "/usr/bin/screentime status"
```

---

## 6. Packaging & Release Workflow

1. **Building APK Packages**:
   OpenWrt 25+ uses `apk-tools 3` (ADB v3 format). Packages are built using `scripts/build-apk.sh` (which invokes `apk mkpkg` inside an `alpine:edge` container if not installed locally).
   ```bash
   ./scripts/build-apk.sh
   # Generates:
   #   dist/luci-app-screentime_1.0.0-r1_noarch.apk (versioned)
   #   dist/luci-app-screentime.apk (latest alias)
   #   dist/packages.adb (APKv3 repository feed index)
   ```
2. **Release-Please Automation**:
   - Uses `googleapis/release-please-action` via `.github/workflows/release.yml` on push to `main`.
   - Conventional commits (`feat: ...`, `fix: ...`) trigger automated Release PRs.
   - Merging the Release PR automatically tags the release, updates `CHANGELOG.md` and `luci-app-screentime/Makefile`, builds the APK packages, and publishes them with `SHA256SUMS` to GitHub Releases.
3. **Router Installation**:
   - **One-line installer**:
     ```bash
     wget -qO- https://raw.githubusercontent.com/casonadams/openwrt-packages/main/install.sh | sh
     ```
   - **Repository feed**:
     ```bash
     echo "https://casonadams.github.io/openwrt-packages/packages.adb" > /etc/apk/repositories.d/casonadams.list
     apk update --allow-untrusted
     apk add --allow-untrusted luci-app-screentime
     ```
