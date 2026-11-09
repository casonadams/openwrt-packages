# Changelog

## [2.2.0](https://github.com/casonadams/openwrt-packages/compare/luci-app-familydns-v2.1.0...luci-app-familydns-v2.2.0) (2026-11-09)


### Features

* **familydns:** generated iPhone profiles fail closed by default ([6185cdf](https://github.com/casonadams/openwrt-packages/commit/6185cdf808680b59cb8997301af710313b272444))
* **familydns:** query log per device with Never block / Always block ([6185cdf](https://github.com/casonadams/openwrt-packages/commit/6185cdf808680b59cb8997301af710313b272444))


### Bug Fixes

* **familydns:** IPv6 DNS on the LAN bypassed filtering ([6185cdf](https://github.com/casonadams/openwrt-packages/commit/6185cdf808680b59cb8997301af710313b272444))
* **familydns:** Save & Apply on the page deleted every device ([6185cdf](https://github.com/casonadams/openwrt-packages/commit/6185cdf808680b59cb8997301af710313b272444))

## [2.1.0](https://github.com/casonadams/openwrt-packages/compare/luci-app-familydns-v2.0.0...luci-app-familydns-v2.1.0) (2026-11-02)


### Features

* **familydns:** redesign the page around devices, profiles and connection ([a8266a1](https://github.com/casonadams/openwrt-packages/commit/a8266a165da7de67dda6b8f9430a7657a0a88048))
* **familydns:** shared ad-blocking list with custom allow and block domains ([a3b90bb](https://github.com/casonadams/openwrt-packages/commit/a3b90bb0ada93c8f31af05befe1f2db93928e709))

## [2.0.0](https://github.com/casonadams/openwrt-packages/compare/luci-app-familydns-v1.0.2...luci-app-familydns-v2.0.0) (2026-11-02)


### ⚠ BREAKING CHANGES

* **familydns:** profiles are upstream lists only; filtering comes from the upstream resolver.

### Features

* **familydns:** per-device and default query counters ([9610b71](https://github.com/casonadams/openwrt-packages/commit/9610b7108e8c4cf4187b754364e2d8e5f043822a))
* **familydns:** replace AdGuard Home with dnsdist ([713e273](https://github.com/casonadams/openwrt-packages/commit/713e27338424fde316e20c02aa72690038eeb899))


### Bug Fixes

* **familydns:** apply the resolver immediately on upgrade ([cefa932](https://github.com/casonadams/openwrt-packages/commit/cefa932fffda0264df7d8ba01cf203debef4b54e))

## [1.0.2](https://github.com/casonadams/openwrt-packages/compare/luci-app-familydns-v1.0.1...luci-app-familydns-v1.0.2) (2026-11-02)


### Bug Fixes

* **luci-app-familydns:** rate limit each device on its own ([b2f100f](https://github.com/casonadams/openwrt-packages/commit/b2f100fff9fbbedb1eea1869bb9365d8cc2e9158))
* **luci-app-familydns:** rate limit each device on its own instead of sharing 20 queries/s per subnet ([fa0399e](https://github.com/casonadams/openwrt-packages/commit/fa0399e6b5c6335cb10db506cb54bb2825124dc6))

## [1.0.1](https://github.com/casonadams/openwrt-packages/compare/luci-app-familydns-v1.0.0...luci-app-familydns-v1.0.1) (2026-11-02)


### Bug Fixes

* **luci-app-familydns:** ad blocking was switched off when LuCI dropped the default option ([aec3345](https://github.com/casonadams/openwrt-packages/commit/aec334577cd7eb971ef2bbd5c29993763b6c52fe))
* **luci-app-familydns:** ad blocking was switched off when LuCI dropped the default option ([715ba7a](https://github.com/casonadams/openwrt-packages/commit/715ba7acae2256bc6cc0f72d22bbaf3923c64232))
* **luci-app-familydns:** clean-install DuckDNS step ([369e7e7](https://github.com/casonadams/openwrt-packages/commit/369e7e722f7c8d80a9009d3dcbf62e422e4f029a))
* **luci-app-familydns:** report DuckDNS connectivity failures correctly and flush the resolver cache ([32d78fb](https://github.com/casonadams/openwrt-packages/commit/32d78fbfce22a2704b15f4e266e51541161adce8))

## 1.0.0 (2026-10-31)


### Features

* **luci-app-familydns:** add per-device AdGuard Home profiles over DoT ([b397068](https://github.com/casonadams/openwrt-packages/commit/b397068098a612bdfb1b8444a66c1fe69b9cf39f))
* **luci-app-familydns:** CleanBrowsing defaults and fallback DNS servers ([a666122](https://github.com/casonadams/openwrt-packages/commit/a666122867fdc991c51989460c0f88603b2624ae))
* **luci-app-familydns:** default the adult profile to CleanBrowsing's adult filter ([fdf6184](https://github.com/casonadams/openwrt-packages/commit/fdf61848fc9d63b11c39ece29e3f18bb3bc01d32))
* **luci-app-familydns:** familydns admin --password prints just the AdGuard Home password ([83f60e6](https://github.com/casonadams/openwrt-packages/commit/83f60e60ca146572941d57761505a4749ee27d6f))
* **luci-app-familydns:** per-device AdGuard Home profiles over DoT ([e50fe86](https://github.com/casonadams/openwrt-packages/commit/e50fe86ae69ec47762d45da1d13b6772082512c5))
* **luci-app-familydns:** per-profile DNS servers, defaulting to Cloudflare's family and standard endpoints ([6a71af8](https://github.com/casonadams/openwrt-packages/commit/6a71af8bc8e69087c583c48446127dfe03c6d3b0))
* **luci-app-familydns:** set AllowFailover in generated iOS profiles ([b21e6f4](https://github.com/casonadams/openwrt-packages/commit/b21e6f4223df478b5036b93817091a4681c68031))
* **luci-app-familydns:** use AdGuard Home for the whole network's DNS, LAN addresses and a login shortcut ([a720cc2](https://github.com/casonadams/openwrt-packages/commit/a720cc2b4317182342d3f8f59d576a7e4c11280e))


### Bug Fixes

* **luci-app-familydns:** accept blank form input so settings and new device rows save ([b9cbf75](https://github.com/casonadams/openwrt-packages/commit/b9cbf757f2b0ee46c7b9f7f823adbbbcb493cef7))
* **luci-app-familydns:** copy the password over plain HTTP and let Open AdGuard Home copy it for you ([c94440c](https://github.com/casonadams/openwrt-packages/commit/c94440cbcd2f70562ac666402f7ed7eddeb09cd0))
* **luci-app-familydns:** track the background setup process and wait for AdGuard Home restarts ([328d251](https://github.com/casonadams/openwrt-packages/commit/328d25105c3f68111d853eb624913770d92f51c2))
