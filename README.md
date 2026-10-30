# OpenWrt Packages

A collection of custom OpenWrt applications and utilities maintained by [Cason Adams](https://github.com/casonadams).

---

## `luci-app-internet-schedule`

An automated internet access scheduler, bedtime curfew, and parental control manager for OpenWrt 24+ and 25+ (with `firewall4` nftables).

Provides a native LuCI Web UI under **Services → Internet Schedule** as well as a fast terminal CLI (`internet-schedule`).

### Features

- **Device Auto-Discovery**: Easily select target devices (Rokus, Samsung TVs, tablets, consoles) from a live dropdown populated by router DHCP leases and ARP neighbors—no manual typing of MAC addresses required.
- **Timezone Alignment & Verification**: Live comparison between the **Router System Clock** and the **Client Browser Clock**. Highlights whether times are aligned or warns if the router is running in UTC or another timezone.
- **True Hard Cutoff**: Operates inside Linux kernel `nftables` via `firewall4`. When cutoff arrives, active TCP/UDP video streams (Netflix, YouTube, Disney+, gaming sessions) are severed immediately using `conntrack`.
- **Quick Override Controls**: One-click buttons to **Unlock All** (unrestricted access for weekends/holidays), **Enforce Schedule** (daily routine), **Emergency Lockdown** (instant shutoff), or **+30 Minutes Bonus Time**.
- **No Hard-Coded Defaults**: Clean, neutral template. Configure your own hours and pick your own devices from the UI.
- **Native OpenWrt Integration**: Full UCI configuration (`/etc/config/internet_schedule`) preserved across sysupgrades.

---

### Installation

#### Method 1: Install from GitHub Release (APK)

On OpenWrt 25+:
```bash
apk add https://github.com/casonadams/openwrt-packages/releases/latest/download/luci-app-internet-schedule_1.0.0-r1_all.apk
```

#### Method 2: Manual Direct Install

```bash
# Clone and copy to router
git clone https://github.com/casonadams/openwrt-packages.git
cd openwrt-packages/luci-app-internet-schedule

scp -r root/etc/* root@192.168.1.1:/etc/
scp -r root/usr/* root@192.168.1.1:/usr/
scp -r htdocs/* root@192.168.1.1/www/

# Restart services
ssh root@192.168.1.1 "/etc/init.d/rpcd restart && /etc/init.d/internet-schedule restart"
```

---

### Web Interface Usage

1. Open your router web interface (e.g., `http://192.168.1.1`).
2. Navigate to **Services → Internet Schedule**.
3. **Verify Timezone**: Check the status card at the top. It displays your router's clock, your browser's clock, and confirms whether they align.
4. **Set Hours**: Enter your daily allowed window (e.g., `18:00:00` to `19:30:00`).
5. **Add Devices**: In the **Target Devices** table, click **Add**. Give the device a friendly name (e.g. `Roku Streambar` or `Samsung TV`), and choose the MAC address from the dropdown list of active devices.
6. Click **Save & Apply**.

---

### Command-Line Interface (`internet-schedule`)

You can also control the scheduler from any terminal or SSH session:

```bash
# View current status, clock, and active devices
internet-schedule status

# Unlock (turn off rules, grant unrestricted access)
internet-schedule unlock

# Lock (re-engage scheduled curfew)
internet-schedule lock

# Change allowed hours
internet-schedule set-time 18:00 19:30
# (Accepts 12-hour format too)
internet-schedule set-time 6:00pm 7:30pm

# Give 30 minutes bonus time (automatically re-locks after 30 mins)
internet-schedule allow-now 30

# Immediate bedtime cutoff
internet-schedule block-now

# Scan active network devices & MACs
internet-schedule scan

# Add or remove devices from terminal
internet-schedule add-device "Samsung TV Living Room" 00:11:22:33:44:55
internet-schedule remove-device "Samsung TV Living Room"
```

---

### License

Apache License 2.0. Open source for the OpenWrt community.
