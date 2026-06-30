#!/bin/sh
set -eu

node /usr/local/lib/node_modules/npm/bin/npm-cli.js install -g --ignore-scripts --min-release-age=0 --no-fund --no-audit --loglevel=error --progress=false @earendil-works/pi-coding-agent

rm -f /usr/local/bin/pi
cat > /usr/local/bin/pi <<'EOF'
#!/bin/sh
exec node /usr/local/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js "$@"
EOF
chmod +x /usr/local/bin/pi
