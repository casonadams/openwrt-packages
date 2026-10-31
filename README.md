# OpenWrt Packages

Custom OpenWrt packages, published as a signed apk feed for OpenWrt 25+.

## Packages

| Package | Description |
|---|---|
| [`luci-app-screentime`](luci-app-screentime/) | Schedule-based parental controls: devices are online only during scheduled windows |
| [`luci-app-familydns`](luci-app-familydns/) | Per-device AdGuard Home profiles over DNS-over-TLS, usable from anywhere (DuckDNS, Let's Encrypt, iOS profiles) |

## Install

```bash
wget -qO- https://raw.githubusercontent.com/casonadams/openwrt-packages/main/install.sh | sh -s -- luci-app-screentime
```

That trusts the signing key, adds the feed, and installs the package. Upgrade later with `apk update && apk upgrade`.

<details>
<summary>Manual steps</summary>

```bash
wget -O /etc/apk/keys/casonadams.pub https://casonadams.github.io/openwrt-packages/casonadams.pub
echo "https://casonadams.github.io/openwrt-packages/packages.adb" > /etc/apk/repositories.d/casonadams.list
apk update
apk add luci-app-screentime
```

</details>

Each package has its own README, changelog and [releases](../../releases).

## Contributing

See [`AGENTS.md`](AGENTS.md) for the layout, how to add a package, and how builds and releases work.

## License

Apache License 2.0.
