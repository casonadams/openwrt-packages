# Handoff: `luci-app-internet-schedule`

## Context & Architecture Overview
This repository contains **`luci-app-internet-schedule`**, an OpenWrt 24+/25+ package providing an intuitive, mobile-friendly parental control and internet curfew scheduler. It controls network access for target devices (e.g. kid tablets, Roku Streambars, Samsung Smart TVs) while leaving all other household devices completely unrestricted.

### Target Hardware & Environment
- **Router**: Ubiquiti EdgeRouter X (MIPS MT7621, 256 MB RAM) at `192.168.1.1`
- **Firmware**: OpenWrt 25.12.6 with `firewall4` (nftables), `conntrack`, `dnsmasq`, and `https-dns-proxy` (CleanBrowsing Family Filter)
- **Timezone**: `America/Denver` (MST7MDT)

---

## Directory Structure
```text
openwrt-packages/
├── .github/workflows/
│   └── build.yml               # GitHub Actions workflow: packages .apk artifacts on push/release
├── README.md                   # Public documentation, CLI guide, and screenshots
├── HANDOFF.md                  # This file
└── luci-app-internet-schedule/
    ├── Makefile                # Standard OpenWrt LuCI package specification
    ├── htdocs/luci-static/resources/view/
    │   └── internet-schedule/
    │       └── overview.js     # Client-side LuCI JavaScript Web UI (mobile-first)
    └── root/
        ├── etc/
        │   ├── config/
        │   │   └── internet_schedule    # UCI configuration storage (Schedules & Devices)
        │   ├── init.d/
        │   │   └── internet-schedule    # Procd init service (syncs firewall & cron)
        │   └── uci-defaults/
        │       └── 99_internet-schedule # Post-install auto-enablement script
        └── usr/
            ├── bin/
            │   └── internet-schedule    # Shell backend engine: computes time, manages nftables & conntrack
            └── share/
                ├── luci/menu.d/
                │   └── luci-app-internet-schedule.json  # Adds entry under Services -> Internet Schedule
                └── rpcd/acl.d/
                    └── luci-app-internet-schedule.json   # RPCD permissions (UCI, ubus, file exec)
```

---

## Key Design Principles & Current UX State

1. **WYSIWYG Saving Model**:
   - Standard LuCI 3-button staging (`Save`, `Save & Apply`, and `Reset`) has been replaced by a single, decisive **`[ Save ]`** button (`handleSaveApply: null; handleReset: null`).
   - Clicking `[ Save ]` parses form values, runs `uci.commit('internet_schedule')`, executes `/usr/bin/internet-schedule sync` directly via `rpcd`, and refreshes the page with zero staged-change badges or rollback timeouts.

2. **Section Terminology**:
   - **`Allowed Times`**: Explicitly states when internet access is open. Outside these hours, traffic is dropped.
   - **`Managed Devices`**: Lists only devices subject to these curfews. All unlisted network clients have full 24/7 internet.

3. **Custom UI Form Components**:
   - **`StatusFlag`**: Custom interactive button toggling between green **Enabled** and muted **Disabled** (replaces browser checkboxes). Includes custom `formvalue(section_id)` so LuCI form parsing reads the hidden input directly.
   - **`CompactDayPicker`**: Single-letter pill buttons (`[M] [T] [W] [T] [F] [S] [S]`) occupying ~180px width, replacing bulky multi-select dropdowns.
   - **`TimePicker12h`**: 3 compact dropdowns for Hour (`1..12`), Minute (`:00..:55`), and Period (`AM/PM`). Converts to/from 24-hour HH:MM:SS for UCI/nftables.
   - **`End Time`**: Real-time calculated display of the cutoff time based on Start Time + Duration.

4. **Apple Screen Time Style State Override**:
   - Outside scheduled hours:
     - Badge: `● Schedule Enforced` (Green)
     - Action button: `[ Bypass Until Next Window ]` (Red, `border-radius: 4px`)
   - When bypassed:
     - Badge: `● Schedule Bypassed` (Red)
     - Action button: `[ Resume Schedule ]` (Blue, `border-radius: 4px`)
   - Bypassing automatically self-cancels at the next scheduled boundary via router crontab (`/usr/bin/internet-schedule on-schedule-boundary`).

5. **Hard Cutoff Enforcement**:
   - Packets are dropped at kernel level in nftables (`firewall4`).
   - At the exact scheduled cutoff minute, a cron job executes `conntrack -D` to sever active established video streams (Netflix, YouTube, Disney+, Roblox) immediately.

---

## Known Next Steps & Potential Enhancements

1. **Host Discovery in Dropdown**:
   - Currently uses `luci-rpc getHostHints`.
   - Consider augmenting with active mDNS/SSDP scan to show friendly manufacturer names (e.g. "Roku Streambar", "Samsung QLED") in the dropdown alongside IP and MAC.

2. **Per-Device Schedule Assignment (Optional)**:
   - Currently, all enabled schedules apply to all enabled managed devices.
   - If desired, could add a multi-value select to assign specific devices to specific schedules (e.g. TV gets Schedule A, iPad gets Schedule B).

3. **Packaging / Release**:
   - GitHub Actions workflow (`.github/workflows/build.yml`) builds `.apk` packages on commit/release tag.
   - Test installing directly on OpenWrt via `apk add <github-release-url>`.

---

## Testing & Deployment Commands
```bash
# Push view changes to live router:
scp openwrt-packages/luci-app-internet-schedule/htdocs/luci-static/resources/view/internet-schedule/overview.js root@192.168.1.1:/www/luci-static/resources/view/internet-schedule/overview.js

# Push engine script to live router:
scp openwrt-packages/luci-app-internet-schedule/root/usr/bin/internet-schedule root@192.168.1.1:/usr/bin/internet-schedule

# Restart rpcd to flush LuCI cache on router:
ssh root@192.168.1.1 "rm -rf /tmp/luci-* /var/luci-*; /etc/init.d/rpcd restart"

# Test CLI status:
ssh root@192.168.1.1 "/usr/bin/internet-schedule status"
```
