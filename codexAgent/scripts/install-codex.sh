#!/bin/sh
set -eu

node /usr/local/lib/node_modules/npm/bin/npm-cli.js install -g --ignore-scripts --min-release-age=0 --no-fund --no-audit --loglevel=error --progress=false @openai/codex

rm -f /usr/local/bin/codex
cat > /usr/local/bin/codex <<'EOF'
#!/bin/sh
exec node /usr/local/lib/node_modules/@openai/codex/bin/codex.js "$@"
EOF
chmod +x /usr/local/bin/codex
