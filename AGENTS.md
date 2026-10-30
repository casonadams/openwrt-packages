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
├── HANDOFF.md                  # Subsystem state, context, and architecture overview
├── README.md                   # Public documentation, CLI guide, screenshots
├── install.sh                  # One-line instant installer for OpenWrt
├── release-please-config.json  # Release-Please configuration
├── .release-please-manifest.json # Release-Please version manifest
├── scripts/
│   ├── build-apk.sh            # APKv3 ADB package assembler via apk mkpkg
│   └── generate-pages.sh       # Assembles GitHub Pages repo feed and landing page
├── tests/
│   └── test_engine.sh          # 23-assertion unit test suite
└── luci-app-screentime/
    ├── Makefile                # Standard OpenWrt LuCI package specification
    ├── htdocs/luci-static/resources/view/
    │   └── screentime/
    │       └── overview.js     # Client-side LuCI JavaScript Web UI (Model A: GridSection + modal)
    └── root/
        ├── etc/
        │   ├── config/
        │   │   └── screentime         # UCI configuration (schedules & devices)
        │   ├── init.d/
        │   │   └── screentime         # Procd init service (syncs firewall & cron)
        │   └── uci-defaults/
        │       └── 99_screentime      # Post-install auto-enablement script
        └── usr/
            ├── bin/
            │   └── screentime         # Core shell engine: nftables rules, conntrack flush
            └── share/
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
2. **Bottom Action Buttons Model**:
   - **`[ Save & Apply ]` (`handleSaveApply`)**: Validates form values, commits `screentime` to disk via `uci.commit()`, triggers `/usr/bin/screentime sync` directly via RPCD, and reloads the view.
   - **`[ Save ]` (`handleSave`)**: Validates and commits `screentime` to disk via `uci.commit()`.
   - **`[ Reset ]` (`handleReset`)**: Reverts all unstaged modifications and refreshes to saved disk state.
3. **Apple Screen Time Style State Header**:
   - Header control bar displays live router clock, status badge (`Downtime Active` vs `Internet Allowed`), and one-click override trigger button (`Ignore Downtime Until Next Window` / `Turn On Downtime Now`).

---

## 4. Backend Engine Rules (`/usr/bin/screentime`)

- **POSIX Shell Only**: Shell scripts must run on BusyBox ash (`/bin/sh`). No bashisms, no arrays, no `[[ ]]`.
- **Zero-Allocation Memory Footprint**: Router has 256MB total RAM. Pure shell parameter expansions used for time/string parsing; zero unnecessary subshells.
- **Firewall Integration**: Interacts cleanly with `firewall4` / nftables table `inet fw4`.
- **Conntrack Flushing**: Cutoff enforcement flushes active conntrack sessions (`conntrack -D -s <IP>`) so established video/game streams drop immediately.

---

## 5. Live Router Testing & Deployment

Direct live-testing commands against `root@192.168.1.1`:

```bash
# Push view changes to live router (use -O for Dropbear legacy scp)
scp -O luci-app-screentime/htdocs/luci-static/resources/view/screentime/overview.js root@192.168.1.1:/www/luci-static/resources/view/screentime/overview.js

# Push engine script to live router
scp -O luci-app-screentime/root/usr/bin/screentime root@192.168.1.1:/usr/bin/screentime

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
