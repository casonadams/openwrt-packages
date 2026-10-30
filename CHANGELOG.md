# Changelog

## [1.1.0](https://github.com/casonadams/openwrt-packages/compare/v1.0.0...v1.1.0) (2026-10-30)


### Features

* adopt Screen Time (luci-app-screentime) with mobile-responsive Model A GridSection ([2f04e2a](https://github.com/casonadams/openwrt-packages/commit/2f04e2a783a01d085f2d9c96fec1a83186e3ff99))
* adopt single Save button that commits and syncs directly (no staged changes or rollback) ([2d0ee3d](https://github.com/casonadams/openwrt-packages/commit/2d0ee3d409031b6d6249ae9751bba2e1a3a1e81e))
* Apple Screen Time state machine with 'Ignore Downtime Until Schedule' and 'Turn On Downtime Until Schedule' ([22977a5](https://github.com/casonadams/openwrt-packages/commit/22977a59bde8db5abaaf11920074e45c11ecfc85))
* compact 7-day pill toggle bar (M T W T F S S) for space-saving table layout ([5a1f06f](https://github.com/casonadams/openwrt-packages/commit/5a1f06f5c8da29815295f29555aa3685293955f4))
* fix Save & Apply procd init reload error and adopt Apple-style 'Ignore for Today' ([f378f95](https://github.com/casonadams/openwrt-packages/commit/f378f956cc80b6c57168f1c78a4cf1a2f9fab953))
* implement seamless background auto-commit with debounced sync and in-place 'Saved ✓' indicator (no reloads) ([a0d1352](https://github.com/casonadams/openwrt-packages/commit/a0d135269b7944688f886dda375090ab9333aa42))
* initial commit for luci-app-internet-schedule ([65ea249](https://github.com/casonadams/openwrt-packages/commit/65ea2492bb5ab98c318c6025bf3c75ba0773edf0))
* mobile-first bonus time pills aligned to the left matching all table buttons ([b333b9e](https://github.com/casonadams/openwrt-packages/commit/b333b9ed012026617b723f444c1c5c19c416e8bb))
* multi-schedule builder with Schedule A/B, days, start time, and duration ([79253b4](https://github.com/casonadams/openwrt-packages/commit/79253b44303a8efb543daeaa7296bf6bf818cc0b))
* per-device active toggle with subtle status indicator pills ([94a6b45](https://github.com/casonadams/openwrt-packages/commit/94a6b45d49a7a26ed9d7261816de69ab3f010a3d))
* remove button emojis and replace fixed +30min with selectable duration unlock ([5db9d42](https://github.com/casonadams/openwrt-packages/commit/5db9d424bfff273be6b9fec46fa26824057586f4))
* replace bulky hero cards with a compact, unified control header bar ([c2117ab](https://github.com/casonadams/openwrt-packages/commit/c2117ab47b6729c75dcf16cb991c2238c4dd7d70))
* replace checkboxes with toggle pill buttons (Enabled/Disabled) matching day button aesthetic ([94510d4](https://github.com/casonadams/openwrt-packages/commit/94510d41143fe128e59d7077ae027ecc983538f8))
* replace clutter with a clean Bonus Time bar with remaining time indicator and End Bonus button ([2c6604f](https://github.com/casonadams/openwrt-packages/commit/2c6604f73b6250b73e0eb1a3944453d6cef38789))
* replace master dropdown with one-tap instant override buttons ([b1db175](https://github.com/casonadams/openwrt-packages/commit/b1db175b8a6cc2bf7c4445a5e2a64f783071940b))
* theme-native hero cards and interactive 12-hour time pickers ([c04d8bd](https://github.com/casonadams/openwrt-packages/commit/c04d8bdf8184193daddb834ddb93b222786b417a))


### Bug Fixes

* **ci:** return dist/ ownership to the host user after containerized apk build ([78931fd](https://github.com/casonadams/openwrt-packages/commit/78931fdc8801efbc9d3bc006e1b5a9a634b27cac))
* correct schedule time evaluation logic and adopt intuitive 'Pause/Block Until Next Window' wording ([0e49269](https://github.com/casonadams/openwrt-packages/commit/0e49269d89376a06763997260ffeea3865440068))
* implement custom formvalue method for custom widgets so LuCI form parser can read hidden input values ([5b3b63b](https://github.com/casonadams/openwrt-packages/commit/5b3b63b67870b958bbfe5a65998e2b2b7788bfd7))
* override handleSaveApply to commit UCI and sync rules directly without rollback timeout errors ([5419ea1](https://github.com/casonadams/openwrt-packages/commit/5419ea1b5d781381372d28c261a62c533a293ad2))
* provide explicit validation and rmempty:false for StatusFlag to prevent 'Option Active must not be empty' ([76ebe81](https://github.com/casonadams/openwrt-packages/commit/76ebe81257c46ce8042336bb5f1370a51359f330))
* **ui:** use stock LuCI save/apply flow so Save & Apply commits and clears pending changes ([37004eb](https://github.com/casonadams/openwrt-packages/commit/37004eb2295cee1b4f3dfdcc79ef7b4f762df7a6))

## 1.0.0 (2026-10-30)

### Features

- Initial release of `luci-app-screentime` for OpenWrt 25+
