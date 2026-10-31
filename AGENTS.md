# Engineering Standards & Repository Guidelines: `openwrt-packages`

A monorepo of OpenWrt packages. Each package is a top-level directory with its own `Makefile`, `README.md`, `AGENTS.md`, `tests/`, `version.txt` and `CHANGELOG.md`. Package-specific rules live in the package's `AGENTS.md`.

---

## 1. Repository Layout

```text
openwrt-packages/
├── <package>/                  # e.g. luci-app-screentime (see its AGENTS.md)
├── scripts/
│   ├── build-apk.sh            # Build apk(s) + packages.adb: ./scripts/build-apk.sh [package ...]
│   └── generate-pages.sh       # Assemble the GitHub Pages feed and landing page
├── install.sh                  # One-line installer: adds the feed, installs a package
├── release-please-config.json  # One entry per package (separate versions, tags and PRs)
├── .release-please-manifest.json
└── .github/workflows/
    ├── build.yml               # Lint (ShellCheck, JS/JSON syntax), <package>/tests/run.sh, build
    ├── release.yml             # release-please, then build and upload each released package
    └── pages.yml               # Deploy the apk feed + landing page to GitHub Pages
```

---

## 2. Adding a Package

1. Create `<name>/` with a `Makefile` (`LUCI_TITLE`, `LUCI_DEPENDS`, `PKG_LICENSE`, `PKG_VERSION:=0.0.0 # x-release-please-version`), `root/` and/or `htdocs/`, `README.md`, `AGENTS.md`, and `tests/run.sh`.
2. Seed `<name>/version.txt` (e.g. `0.0.0`) and add the package to `release-please-config.json` (copy the existing entry) and to `.release-please-manifest.json`.
3. Add a row to the table in the root `README.md`.
4. CI, the feed and the landing page pick it up automatically (they iterate `*/Makefile` and `luci-app-*/tests/run.sh`).

Optional `postinst` / `prerm` files in the package directory become apk post-install, post-upgrade and pre-deinstall scripts.

---

## 3. Build, Release, Install

- **Build**: `./scripts/build-apk.sh [package ...]` runs `apk mkpkg` (in an `alpine:edge` container when apk is not installed) and writes `dist/<pkg>-<version>.apk`, `dist/<pkg>.apk` and one shared `dist/packages.adb`. The version comes from `<pkg>/version.txt`; `depends` and license come from the package `Makefile`.
- **Release**: release-please runs on every push to `main`, one release PR per package, based on commits touching that package's directory (Conventional Commits). Merging a PR tags `<package>-v<version>`, updates `<package>/{CHANGELOG.md,version.txt,Makefile}`, and `release.yml` builds that package and uploads its apk and `SHA256SUMS` to the release.
- **Signing**: `scripts/build-apk.sh` signs packages and `packages.adb` with the PEM in `$APK_SIGNING_KEY` (GitHub secret of the same name, used by `pages.yml` and `release.yml`; unsigned when unset). The public key is `keys/casonadams.pub`, published on Pages and fetched by `install.sh`. The private key must never be committed. To rotate: generate a new EC key (`openssl ecparam -name prime256v1 -genkey -noout`), update the secret and `keys/*.pub`; users re-fetch the key.
- **Feed**: `pages.yml` builds every package from `main` into one `packages.adb` and publishes it at `https://casonadams.github.io/openwrt-packages/packages.adb`.
- **Install**: trust `keys/casonadams.pub`, add the feed and `apk add <package>`, or run `install.sh [package]` (it does the same).

---

## 4. Conventions

- Commits: Conventional Commits, scoped by package when useful (`fix(luci-app-screentime): ...`). Only changes inside a package directory affect its release.
- Shell is POSIX (BusyBox ash) and must pass `shellcheck -x -s sh`.
- Tests live in `<package>/tests/` with a `run.sh` entry point; CI runs every `luci-app-*/tests/run.sh`.
- Use documentation MAC addresses (`00:00:5e:00:53:xx`) and generic device names in tests and docs.

## 5. LuCI Form Rules (every `luci-app-*` view)

These bit us twice (screentime's blank MAC rows, familydns' optional upstream list), so they are mandatory:

- **Validators must accept empty input.** LuCI calls `validate` with `''` for blank optional fields, blank `DynamicList` entries and freshly added table rows (the `Add` button saves the whole map). A validator that rejects `''` makes Save fail with "Option ... contains an invalid input value". Write `return fmt.checkOptional(value, isValid, message)` (or `if (!value) return true`).
- **Never set `required = true`** on options whose defaults are empty; use `rmempty = true` and enforce required values where they are used (the engine's own validation, a disabled "Set up" button), not in the form.
- **Blank table rows are pruned on an explicit Save**, not on the Add-triggered silent save: `handleSave` sets a `pruneBlank` flag around the stock handler and the section's `parse` removes rows with no meaningful value when it is set.
- **Custom widgets** (plain DOM, no `ui` element) are never validated by LuCI; check them in the option's `parse`.
- Each package's `tests/test_ui.js` has a guard that fails when a `.validate` function does not handle blank input or when `required = true` appears; keep it passing and keep pure validation helpers in `format.js` with tests for `''`.
