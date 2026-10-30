# OpenWrt Packages

A collection of custom OpenWrt applications and utilities maintained by [Cason Adams](https://github.com/casonadams).

---

## `luci-app-screentime`

An automated screen time scheduler, bedtime curfew, and parental controls manager for OpenWrt 24+ and 25+ (with `firewall4` nftables).

Provides a modern, mobile-responsive LuCI Web UI under **Services → Screen Time** as well as a fast terminal CLI (`screentime`).

### Features

- **Apple Screen Time Style State**: Clean header card with live router clock, live status badge (`Downtime Active` vs `Internet Allowed`), and one-click override button (`Ignore Downtime Until Next Window` / `Turn On Downtime Now`).
- **Responsive Mobile-First UI (Model A)**: Uses LuCI's native `GridSection` with a compact 4-column summary table on desktop and mobile, with full-screen touch-friendly modal editing for schedules.
- **Per-Schedule Device Targeting**: Schedules can apply to `All Managed Devices` or specific devices.
- **Optional Device Names & Auto-Discovery**: Select target devices from a live dropdown populated by router DHCP leases and ARP host hints; friendly names auto-populate if left blank.
- **True Kernel Cutoff**: Operates inside Linux kernel `nftables` via `firewall4`. When downtime arrives, active TCP/UDP video/game streams (Netflix, YouTube, Disney+, Xbox, PlayStation) are severed immediately using `conntrack`.
- **Native OpenWrt Integration**: Full UCI configuration (`/etc/config/screentime`) preserved across sysupgrades. Zero daemon overhead.

---

### Installation

#### Method 1: Add Package Repository Feed (OpenWrt 25+)

Add our custom feed directly to your router so you can install and update via standard `apk`:
```bash
echo "https://casonadams.github.io/openwrt-packages/packages.adb" > /etc/apk/repositories.d/casonadams.list
apk update --allow-untrusted
apk add --allow-untrusted luci-app-screentime
```

#### Method 2: One-Line Installer Script

Quick install without adding permanent repository feeds:
```bash
wget -qO- https://raw.githubusercontent.com/casonadams/openwrt-packages/main/install.sh | sh
```
*(or `curl -sSL https://raw.githubusercontent.com/casonadams/openwrt-packages/main/install.sh | sh`)*

#### Method 3: Direct Download & Install from GitHub Release (APK)

```bash
wget -O /tmp/luci-app-screentime.apk https://github.com/casonadams/openwrt-packages/releases/latest/download/luci-app-screentime.apk
apk add --allow-untrusted /tmp/luci-app-screentime.apk
rm /tmp/luci-app-screentime.apk
/etc/init.d/rpcd restart
```

#### Method 4: Manual Direct Copy (Development)

```bash
# Clone and copy to router
git clone https://github.com/casonadams/openwrt-packages.git
cd openwrt-packages/luci-app-screentime

scp -r root/etc/* root@192.168.1.1:/etc/
scp -r root/usr/* root@192.168.1.1:/usr/
scp -r htdocs/* root@192.168.1.1/www/

# Restart services
ssh root@192.168.1.1 "/etc/init.d/rpcd restart && /etc/init.d/screentime restart"
```

---

### Web Interface Usage

1. Open your router web interface (e.g., `http://192.168.1.1`).
2. Navigate to **Services → Screen Time**.
3. **Allowed Schedules**: Review active schedules. Tap **Edit** on any schedule to configure days of the week, start time (12h format), duration, and target devices.
4. **Managed Devices**: Add devices from the dropdown of active network hosts. Friendly names are optional and automatically detect the device's hostname.
5. Click **Save & Apply**.

---

### Command-Line Interface (`screentime`)

You can control Screen Time from any SSH session or terminal:

```bash
# View current status, clock, and active devices
screentime status

# Ignore downtime (grant access until next scheduled window)
screentime ignore-downtime

# Turn on downtime immediately
screentime turn-on-downtime

# Clear override and revert to normal schedule
screentime clear-override

# Add a target device (friendly name is optional)
screentime add-device "Samsung TV" 00:11:22:33:44:55
screentime add-device 00:00:5e:00:53:03

# Remove a target device
screentime remove-device 00:00:5e:00:53:03
```

---

### License

Apache License 2.0. Open source for the OpenWrt community.
