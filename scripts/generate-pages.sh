#!/bin/sh
set -e

OUTPUT_DIR="${OUTPUT_DIR:-dist}"

# Ensure packages and packages.adb are built
./scripts/build-apk.sh luci-app-screentime

cat << 'EOF' > "${OUTPUT_DIR}/index.html"
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenWrt Package Repository | casonadams</title>
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --border: #30363d;
      --text: #c9d1d9;
      --heading: #f0f6fc;
      --accent: #58a6ff;
      --code-bg: #0a0d12;
      --badge: #238636;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      line-height: 1.6;
      margin: 0;
      padding: 40px 20px;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
    }
    h1, h2, h3 {
      color: var(--heading);
    }
    .header {
      border-bottom: 1px solid var(--border);
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    .badge {
      display: inline-block;
      background: var(--badge);
      color: #fff;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
      vertical-align: middle;
      margin-left: 8px;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 24px;
      margin-bottom: 24px;
    }
    pre {
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 14px;
      overflow-x: auto;
      font-size: 14px;
      color: #79c0ff;
    }
    code {
      font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace;
    }
    a {
      color: var(--accent);
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
    ul {
      padding-left: 20px;
    }
    li {
      margin-bottom: 8px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>OpenWrt Package Repository <span class="badge">APKv3</span></h1>
      <p>Custom OpenWrt applications and utilities maintained by <a href="https://github.com/casonadams" target="_blank">Cason Adams</a>.</p>
    </div>

    <div class="card">
      <h2>1. Add Repository Feed (OpenWrt 25+)</h2>
      <p>Add this repository to your router's APK package feed list:</p>
      <pre><code>echo "https://casonadams.github.io/openwrt-packages/packages.adb" > /etc/apk/repositories.d/casonadams.list
apk update --allow-untrusted
apk add --allow-untrusted luci-app-screentime</code></pre>
    </div>

    <div class="card">
      <h2>2. One-Line Instant Installer</h2>
      <p>Alternatively, install directly via curl or wget without adding repository feeds:</p>
      <pre><code>wget -qO- https://raw.githubusercontent.com/casonadams/openwrt-packages/main/install.sh | sh</code></pre>
    </div>

    <div class="card">
      <h2>Available Packages</h2>
      <ul>
        <li>
          <strong><a href="https://github.com/casonadams/openwrt-packages/tree/main/luci-app-screentime">luci-app-screentime</a></strong>:
          LuCI Web UI and backend engine for screen time scheduling, bedtime curfew, and parental controls.
          <br>
          <a href="luci-app-screentime.apk">Download APK</a> | <a href="https://github.com/casonadams/openwrt-packages/releases/latest">Release Notes</a>
        </li>
      </ul>
    </div>

    <div class="card">
      <h2>Repository Metadata</h2>
      <p>APKv3 Database Index: <a href="packages.adb">packages.adb</a></p>
      <p>Source Code: <a href="https://github.com/casonadams/openwrt-packages">github.com/casonadams/openwrt-packages</a></p>
    </div>
  </div>
</body>
</html>
EOF

echo "GitHub Pages artifact assembled in ${OUTPUT_DIR}/:"
ls -lh "${OUTPUT_DIR}"
