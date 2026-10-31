# Changelog

## [1.1.0](https://github.com/casonadams/openwrt-packages/compare/v1.0.0...v1.1.0) (2026-10-31)


### Features

* adopt Screen Time (luci-app-screentime) with mobile-responsive Model A GridSection ([fbb27ec](https://github.com/casonadams/openwrt-packages/commit/fbb27ec132aec29615dbd992d0e26b86517d5967))
* adopt single Save button that commits and syncs directly (no staged changes or rollback) ([9a883f5](https://github.com/casonadams/openwrt-packages/commit/9a883f577b97e8f3b7781ee2d2ff0c750c007219))
* Apple Screen Time state machine with 'Ignore Downtime Until Schedule' and 'Turn On Downtime Until Schedule' ([8b45f38](https://github.com/casonadams/openwrt-packages/commit/8b45f38fc1e260e80ab6d32e2f5e2f43a6fe2377))
* compact 7-day pill toggle bar (M T W T F S S) for space-saving table layout ([4476c27](https://github.com/casonadams/openwrt-packages/commit/4476c27bbbec9c6b8cac493147cc11d705c2fe4d))
* fix Save & Apply procd init reload error and adopt Apple-style 'Ignore for Today' ([a456b86](https://github.com/casonadams/openwrt-packages/commit/a456b8605f650c044bbe98d6e554c023a298ff98))
* implement seamless background auto-commit with debounced sync and in-place 'Saved ✓' indicator (no reloads) ([fca404f](https://github.com/casonadams/openwrt-packages/commit/fca404f85f1142b6d3528097e38771d9ddb109ca))
* initial commit for luci-app-internet-schedule ([84137ac](https://github.com/casonadams/openwrt-packages/commit/84137ac5d6769fb1491c704e503dc69e9e4c2fb2))
* mobile-first bonus time pills aligned to the left matching all table buttons ([d74d1a9](https://github.com/casonadams/openwrt-packages/commit/d74d1a982b87ca42c25006d603c3b137b556abcb))
* multi-schedule builder with Schedule A/B, days, start time, and duration ([35c4a3d](https://github.com/casonadams/openwrt-packages/commit/35c4a3df4572998d54b99268a883f29c6b074ff0))
* **packaging:** start on install and clean up on uninstall ([bf9f0ca](https://github.com/casonadams/openwrt-packages/commit/bf9f0caa72271f9e780b5891ab21b2177cf48f4a))
* per-device active toggle with subtle status indicator pills ([09e8601](https://github.com/casonadams/openwrt-packages/commit/09e8601b233e9ccd1a3084ed795bb98052ac4f25))
* remove button emojis and replace fixed +30min with selectable duration unlock ([8c0b63c](https://github.com/casonadams/openwrt-packages/commit/8c0b63cae53876a6439e292fc88089ad3a031a25))
* replace bulky hero cards with a compact, unified control header bar ([8528405](https://github.com/casonadams/openwrt-packages/commit/8528405e0ae29f12be1f6225651bad4845bbd15b))
* replace checkboxes with toggle pill buttons (Enabled/Disabled) matching day button aesthetic ([56f4f5f](https://github.com/casonadams/openwrt-packages/commit/56f4f5fca3b1eb1284abe88f06c897984976f829))
* replace clutter with a clean Bonus Time bar with remaining time indicator and End Bonus button ([7324a3c](https://github.com/casonadams/openwrt-packages/commit/7324a3c33a4c13287f2143ea07710745a02b4413))
* replace master dropdown with one-tap instant override buttons ([5db9d96](https://github.com/casonadams/openwrt-packages/commit/5db9d9669609db74e8de27b3d4340689c6a51f22))
* theme-native hero cards and interactive 12-hour time pickers ([7c8483b](https://github.com/casonadams/openwrt-packages/commit/7c8483bb193b19077ac37f3542ba31e367817b6c))
* **ui:** show engine state, per-device status and validate schedule input ([6a5e2b3](https://github.com/casonadams/openwrt-packages/commit/6a5e2b3f736c00aa415019dd654fed7344fb105a))


### Bug Fixes

* **ci:** return dist/ ownership to the host user after containerized apk build ([2704d4f](https://github.com/casonadams/openwrt-packages/commit/2704d4fef5351f31fbaf1f8c54adc938ff8cf329))
* correct schedule time evaluation logic and adopt intuitive 'Pause/Block Until Next Window' wording ([51d4ad3](https://github.com/casonadams/openwrt-packages/commit/51d4ad31efcbb61fee35eec5a030fe9fcab2ffd1))
* **engine:** enforce schedules with one decision function and a private nft table ([3ad70e0](https://github.com/casonadams/openwrt-packages/commit/3ad70e040604163d4624a6c87c36d973bee20141))
* implement custom formvalue method for custom widgets so LuCI form parser can read hidden input values ([3525ebe](https://github.com/casonadams/openwrt-packages/commit/3525ebe8ac1210bd4719cb935be45cfb13feaf3a))
* override handleSaveApply to commit UCI and sync rules directly without rollback timeout errors ([5483321](https://github.com/casonadams/openwrt-packages/commit/5483321a76393c577c5cd7dc423b81e916bab34d))
* provide explicit validation and rmempty:false for StatusFlag to prevent 'Option Active must not be empty' ([6676597](https://github.com/casonadams/openwrt-packages/commit/66765972f8a0bef026bd473d178ba971d33b3747))
* **ui:** use stock LuCI save/apply flow so Save & Apply commits and clears pending changes ([a84b7db](https://github.com/casonadams/openwrt-packages/commit/a84b7db8b8b15f31501a807671147774f0016a11))

## 1.0.0 (2026-10-30)

### Features

- Initial release of `luci-app-screentime` for OpenWrt 25+
