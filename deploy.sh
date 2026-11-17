#!/bin/sh
# This script deploys to YOUR Cloudflare worker and YOUR KV namespace only.
set -eu
cd "$(dirname "$0")"
./build.sh
npx --yes wrangler deploy
