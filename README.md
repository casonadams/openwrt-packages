# OpenWrt Packages

Custom OpenWrt packages.

## `luci-app-screentime`

Schedule-based parental controls for OpenWrt 24+/25+ (nftables). Managed devices have network access **only during scheduled windows**; outside every window they are blocked, unless you choose **Ignore Downtime Until Next Window**.

- **LuCI UI** under **Services → Screen Time**: a banner with the current state and when it ends, a per-device status column, and a one-click override. Schedules are edited in a mobile-friendly modal (days, start time, duration, target devices).
- **CLI** (`screentime`) for the same controls over SSH.
- **Hard cutoff**: blocked MACs live in a private `inet screentime` nft table (`firewall4` config is untouched), and active connections of a newly blocked device are dropped with `conntrack` (IPv4 and IPv6).
- **No daemon**: cron reconciles every minute and when NTP syncs. Configuration is plain UCI (`/etc/config/screentime`) and survives sysupgrades.

### Install

With the package feed (OpenWrt 25+):

```bash
echo "https://casonadams.github.io/openwrt-packages/packages.adb" > /etc/apk/repositories.d/casonadams.list
apk update --allow-untrusted
apk add --allow-untrusted luci-app-screentime
```

Or the one-line installer:

```bash
wget -qO- https://raw.githubusercontent.com/casonadams/openwrt-packages/main/install.sh | sh
```

The service is enabled and started on install; removing the package cleans up its rules and cron entry.

### Use

**Web:** open **Services → Screen Time**, add devices under **Managed Devices**, edit schedules under **Allowed Schedules**, then **Save & Apply**.

**CLI:**

```bash
screentime status [--json]        # state and per-device status
screentime ignore-downtime        # devices allowed until the next window opens
screentime turn-on-downtime       # devices blocked until the current window closes
screentime clear-override         # back to the schedule
screentime add-device "Living Room TV" 00:11:22:33:44:55
screentime remove-device 00:11:22:33:44:55
screentime reconcile              # apply now (cron does this every minute)
```

### Notes

- A device with no schedule, or no enabled schedule, stays blocked.
- Devices that use a randomised ("private") MAC address can evade a MAC-based block; turn that off for managed devices.

### Development

```bash
sh tests/test_engine.sh   # engine logic with a fake clock
node tests/test_ui.js     # UI formatting helpers
docker run --rm --cap-add NET_ADMIN -v "$PWD:/w" -w /w openwrt/rootfs:x86-64-24.10.2 \
  sh tests/test_integration.sh   # real uci and nft
```

See `AGENTS.md` for architecture and live-router deployment.

## License

Apache License 2.0.
