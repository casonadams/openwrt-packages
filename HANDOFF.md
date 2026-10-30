# Handoff: `luci-app-screentime`

## Context & Architecture Overview
This repository contains **`luci-app-screentime`**, an OpenWrt 24+/25+ package providing an intuitive, mobile-friendly parental controls and screen time scheduler. It controls network access for target devices (e.g. kid tablets, Roku Streambars, Samsung Smart TVs) while leaving all other household devices completely unrestricted.

### Target Hardware & Environment
- **Router**: Ubiquiti EdgeRouter X (MIPS MT7621, 256 MB RAM) at `192.168.1.1`
- **Firmware**: OpenWrt 25.12.6 with `firewall4` (nftables), `conntrack`, `dnsmasq`, and `https-dns-proxy` (CleanBrowsing Family Filter)
- **Timezone**: `America/Denver` (MST7MDT)

---

## Directory Structure
```text
openwrt-packages/
├── .github/workflows/
│   ├── build.yml               # GitHub Actions CI: ShellCheck, test suite, and APK packaging
│   ├── pages.yml               # Deploys APKv3 package repository to GitHub Pages
│   └── release.yml             # Release Please: automated tagging and GitHub Releases
├── README.md                   # Public documentation, CLI guide, and screenshots
├── HANDOFF.md                  # This file
├── install.sh                  # One-line instant installer for OpenWrt
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
        │   │   └── screentime         # UCI configuration storage (Schedules & Devices)
        │   ├── init.d/
        │   │   └── screentime         # Procd init service (syncs firewall & cron)
        │   └── uci-defaults/
        │       └── 99_screentime      # Post-install auto-enablement script
        └── usr/
            ├── bin/
            │   └── screentime         # Shell backend engine: computes time, manages nftables & conntrack
            └── share/
                ├── luci/menu.d/
                │   └── luci-app-screentime.json  # Adds entry under Services -> Screen Time
                └── rpcd/acl.d/
                    └── luci-app-screentime.json   # RPCD permissions (UCI, ubus, file exec)
```

---

## Key Design Principles & Current UX State

1. **Model A Layout (`form.GridSection` + Modal)**:
   - Overview table displays only 4 clean columns: `Enable`, `Schedule Window`, `Applies To`, `Actions: Edit/Delete`. Fits cleanly on mobile screens (`360px–480px`) with zero horizontal overflow.
   - Tapping `[ Edit ]` opens LuCI's native modal dialog, giving full screen width and generous touch targets to configure days, start time, duration, and target devices.

2. **Per-Schedule Device Targeting**:
   - Each schedule can apply to `All Managed Devices` or specific devices.
   - Devices table supports optional friendly names that auto-populate from router host hints.

3. **Apple Screen Time Style State Override**:
   - Header control bar:
     - Badge: `● Downtime Active` (Red) or `● Internet Allowed` (Green)
     - Action button: `[ Ignore Downtime Until Next Window ]` or `[ Turn On Downtime Now ]`
   - Bypassing automatically self-cancels at the next scheduled boundary via router crontab.

4. **Hard Cutoff Enforcement**:
   - Packets are dropped at kernel level in nftables (`firewall4`).
   - Active streams dropped instantly using `conntrack -D`.

---

## Testing & Deployment Commands
```bash
# Push view changes to live router:
scp -O luci-app-screentime/htdocs/luci-static/resources/view/screentime/overview.js root@192.168.1.1:/www/luci-static/resources/view/screentime/overview.js

# Push engine script to live router:
scp -O luci-app-screentime/root/usr/bin/screentime root@192.168.1.1:/usr/bin/screentime

# Restart rpcd to flush LuCI cache on router:
ssh root@192.168.1.1 "rm -rf /tmp/luci-* /var/luci-*; /etc/init.d/rpcd restart"

# Test CLI status:
ssh root@192.168.1.1 "/usr/bin/screentime status"
```
