#!/bin/sh
# Assemble the GitHub Pages site: every package's apk, the shared packages.adb index, and a
# landing page listing the packages found in this repository.
set -e

OUTPUT_DIR="${OUTPUT_DIR:-dist}"
REPO_URL="https://github.com/casonadams/openwrt-packages"
FEED_URL="https://casonadams.github.io/openwrt-packages/packages.adb"

./scripts/build-apk.sh

packages=""
for mk in */Makefile; do
	pkg="${mk%/Makefile}"
	title=$(sed -n 's/^LUCI_TITLE:=//p' "$mk" | sed 's/&/\&amp;/g')
	packages="${packages}
        <li>
          <strong><a href=\"${REPO_URL}/tree/main/${pkg}\">${pkg}</a></strong>: ${title}<br>
          <a href=\"${pkg}.apk\">Download APK</a> | <a href=\"${REPO_URL}/releases?q=${pkg}\">Releases</a>
        </li>"
done

cat > "${OUTPUT_DIR}/index.html" << EOF
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenWrt Package Repository</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
           background: #0d1117; color: #c9d1d9; line-height: 1.6; margin: 0; padding: 40px 20px; }
    .container { max-width: 800px; margin: 0 auto; }
    h1, h2 { color: #f0f6fc; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px;
            padding: 24px; margin-bottom: 24px; }
    pre { background: #0a0d12; border: 1px solid #30363d; border-radius: 6px;
          padding: 14px; overflow-x: auto; color: #79c0ff; }
    a { color: #58a6ff; text-decoration: none; }
    li { margin-bottom: 8px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>OpenWrt Package Repository</h1>

    <div class="card">
      <h2>Add the feed (OpenWrt 25+)</h2>
      <pre><code>echo "${FEED_URL}" > /etc/apk/repositories.d/casonadams.list
apk update --allow-untrusted
apk add --allow-untrusted &lt;package&gt;</code></pre>
    </div>

    <div class="card">
      <h2>Packages</h2>
      <ul>${packages}
      </ul>
    </div>

    <p>Index: <a href="packages.adb">packages.adb</a> | Source: <a href="${REPO_URL}">${REPO_URL#https://}</a></p>
  </div>
</body>
</html>
EOF

echo "GitHub Pages artifact assembled in ${OUTPUT_DIR}/:"
ls -lh "${OUTPUT_DIR}"
