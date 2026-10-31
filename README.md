# OpenWrt Packages

Custom OpenWrt packages, published as an apk feed for OpenWrt 25+.

## Packages

| Package | Description |
|---|---|
| [`luci-app-screentime`](luci-app-screentime/) | Schedule-based parental controls: devices are online only during scheduled windows |

## Install

Add the feed once, then install any package from the table:

```bash
echo "https://casonadams.github.io/openwrt-packages/packages.adb" > /etc/apk/repositories.d/casonadams.list
apk update --allow-untrusted
apk add --allow-untrusted <package>
```

Or in one step: `wget -qO- https://raw.githubusercontent.com/casonadams/openwrt-packages/main/install.sh | sh -s -- <package>` (defaults to `luci-app-screentime`).

Each package has its own README, changelog and versioned [releases](../../releases).

## Contributing

See [`AGENTS.md`](AGENTS.md) for the repository layout, how to add a package, and how builds and releases work.

## License

Apache License 2.0.
