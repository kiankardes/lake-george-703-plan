#!/bin/zsh
# Builds site/index.html from the plan page and deploys it to Cloudflare Pages.
set -e
cd "$(dirname "$0")"
{
  printf '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%%}[hidden]{display:none!important}</style>\n</head>\n<body>\n'
  cat lake-george-70-3-plan.html
  printf '\n</body>\n</html>\n'
} > site/index.html
[ -f ~/Desktop/training-dashboard.html ] && cp ~/Desktop/training-dashboard.html site/history.html
npx --yes wrangler deploy
