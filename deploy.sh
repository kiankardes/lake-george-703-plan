#!/bin/zsh
# Local deploy: build, upload the Garmin history page to KV (it stays out of git), deploy the Worker.
set -e
cd "$(dirname "$0")"
./build.sh
rm -f site/history.html
if [ -f ~/Desktop/training-dashboard.html ]; then
  npx --yes wrangler kv key put history --path ~/Desktop/training-dashboard.html --namespace-id 41c9045d67fa4dc2927f1244acf77bb8 --remote
fi
npx --yes wrangler deploy
